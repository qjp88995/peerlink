# Disconnected 宽限期重连 — 设计文档

日期:2026-06-11
状态:已批准,待写实现计划
范围:`apps/web` 纯客户端逻辑(不动 `packages/protocol`、`apps/signaling`、服务端)

## 背景与动机

当前 PeerLink 在 WebRTC 连接出现任何异常状态时立即彻底关闭会话:`conversation.ts` 的
`onStateChange` 回调里,`disconnected` / `failed` / `closed` 三种 ICE 状态被一视同仁,
全部触发 `conv.closeRemote()` + `teardown()`(释放 WebSocket + RTCPeerConnection,进行中的
文件传输标记失败)。

这一处理对 `disconnected` 过于激进。`disconnected` 是 WebRTC 规范中的**非终态**:弱网下会
间歇触发,且常常自行回到 `connected`(经业界资料 3-0 对抗式验证)。浏览器自身约 5s 无 STUN
binding 响应进入 `disconnected`,约 25–30s 后才进入终态 `failed`。把瞬时抖动当成永久断开,
等于"弱网抖一下就把会话判死",用户体验差。

关键事实(已由代码审查确认):

- **P2P DataChannel 独立于 WebSocket 信令存活**。WS 仅在建连握手阶段使用;P2P 建立后聊天/
  文件全走 DataChannel。因此 ICE 链路自愈后,聊天可无缝继续,挂起的文件传输也无需重发。
- 真正会中断会话的是 ICE 链路本身的断开(`disconnected`/`failed`),而非 WS 抖动。

## 目标

让 WebRTC `disconnected` 这一可自愈的瞬态不再立即终结会话:给定一段宽限期等待自愈,期间以
`reconnecting` 状态在 UI 提示用户,仅在确实无法恢复时才关闭会话。

## 非目标(YAGNI)

明确不在本次范围:

- WebSocket 信令自动重连(指数退避 / 心跳 ping-pong)
- WebRTC ICE restart 重新协商
- 服务端 session resume / 重连宽限期 / 原 peerId 重连
- 文件传输断点续传

理由:经代码实证,WS 仅在握手阶段使用,P2P 建立后空闲;单独做 WS 重连在"P2P 仍存活"时无可见
收益,在"P2P 已死"时又必须依赖被排除的 ICE restart 才能救回,且 naive 重连+重新 join 会让对方
收到第二个 `peer-joined`(新 peerId)从而触发重复建连。故本次只做收益高、零副作用的客户端改动。

## 设计

### 1. 核心行为:`onStateChange` 按 ICE 状态语义分流

位置:`apps/web/src/core/conversation.ts`(现 `startConversation()` 内 `onStateChange`,约
323–332 行)。

将"三态合一立即 teardown"改为按状态语义分流:

| ICE 状态                  | 行为                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `connected` / `completed` | 若处于宽限期:取消宽限计时器,会话状态恢复为 `connected`(自愈成功)                                                           |
| `disconnected`            | 进入 `reconnecting` 状态;启动宽限计时器(`GRACE_MS = 15_000`);**不**调用 `closeRemote()`(进行中的文件传输保持挂起,不判失败) |
| `failed` / `closed`       | 终态:取消宽限计时器,立即 `closeRemote()` + `teardown()`                                                                    |
| 宽限计时器超时(仍未恢复)  | `closeRemote()` + `teardown()`                                                                                             |

要点:

- `GRACE_MS` 定义为模块级常量(15000ms),便于调整。
- 宽限计时器在以下任一情况清除:回到 `connected`/`completed`、进入 `failed`/`closed`、超时
  触发自身、或会话被外部 teardown。需保证计时器不泄漏(teardown 路径要清理)。
- `failed` 是终态,浏览器约 25–30s 自然到达,无需我们额外等待;一旦收到立即关闭。
- `disconnected` 期间 DataChannel 暂时发不出数据,但连接对象仍存活;自愈后 SCTP 关联沿用,
  无需重建会话或重发挂起数据。

### 2. 状态机:`Connection` 类型新增 `reconnecting`

位置:`apps/web/src/core/conversation.ts`(`Connection` 联合类型,约 29–35 行)。

```
'idle' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'
```

`reconnecting` 是介于 `connected` 与 `closed` 之间的瞬态,经由 `onConnection` 回调驱动到
zustand store(`state/conversation-store.ts`)。

### 3. UI 提示

- **会话列表**(`apps/web/src/features/chat/conversation-list.helpers.ts`,`statusTone` 与
  label 映射):`reconnecting` 显示文案"重连中…",状态点用警示色(黄),区别于 `connected`
  (绿)与 dead/closed(灰)。
- **会话详情**(`apps/web/src/features/chat/ConversationView.tsx`,约 86 行 Composer):
  `reconnecting` 时 Composer **禁用**(DataChannel 此刻发不出);顶部显示提示条"网络波动,
  重连中…"。恢复 `connected` 后提示条消失、Composer 自动解除禁用。

### 4. 数据流

```
ICE: connected → disconnected
  └─ onStateChange('disconnected')
       ├─ onConnection('reconnecting')  → store → 列表黄点 + 详情提示条 + Composer 禁用
       └─ start grace timer (15s)

(a) 自愈:ICE → connected/completed (15s 内)
      └─ onStateChange('connected') → clear timer → onConnection('connected') → UI 恢复

(b) 失败:ICE → failed,或 15s 超时仍 disconnected
      └─ clear timer → conv.closeRemote() → teardown() → onConnection('closed') → UI 置灰
```

### 5. 测试(Vitest,`*.spec.ts` 与源码共置,使用 fake timers)

`apps/web/src/core/start-conversation.spec.ts`(或对应共置 spec)补充用例:

1. `disconnected` 不立即 teardown:不调用 `closeRemote`/`teardown`,会话状态变为
   `reconnecting`。
2. 宽限期内回到 `connected`:取消计时器,状态恢复 `connected`,且全程未 teardown。
3. 宽限期超时仍 `disconnected`:触发 `closeRemote` + `teardown`,状态变为 `closed`。
4. `disconnected` 后转 `failed`:立即 `closeRemote` + `teardown`(不等满 15s)。
5. 计时器清理:teardown 后推进 fake timer 不再触发任何回调(无泄漏)。

## 风险与权衡

- **DataChannel 在 ICE 抖动期的可靠性**:业界资料均围绕音视频 media 描述"传输不中断",未专门
  覆盖 DataChannel(SCTP)。本设计假设自愈后 SCTP 关联沿用即可继续,需在实现/手测阶段验证;
  若实测发现自愈后 DataChannel 不可用,再评估是否需要更重的恢复手段(超出本次范围)。
- **15s 宽限**:偏保守(浏览器 `disconnected→failed` 约 25–30s)。用户在抖动时最多等 15s 才
  看到"已断开";若实测体验需要可调常量。
- **Composer 禁用**:`reconnecting` 期间用户无法发消息,简单且不会产生"发了但没送达"的错觉;
  代价是放弃了"本地缓冲待恢复后补发"的体验(那需要额外发送队列,成本更高,本次不做)。

## 涉及文件

- `apps/web/src/core/conversation.ts` — `onStateChange` 分流逻辑、`GRACE_MS` 常量、
  `Connection` 类型扩展、宽限计时器生命周期。
- `apps/web/src/features/chat/conversation-list.helpers.ts` — `reconnecting` 的 statusTone
  与 label。
- `apps/web/src/features/chat/ConversationView.tsx` — `reconnecting` 时 Composer 禁用 +
  顶部提示条。
- 共置 `*.spec.ts` — 上述测试用例。
