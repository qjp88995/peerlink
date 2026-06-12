# 实时语音通话设计（Voice Call）

- 日期：2026-06-12
- 状态：已评审，待实现
- 关联：`docs/superpowers/specs/2026-06-12-voice-messages-design.md`（异步语音消息，本设计的姊妹功能）

## 1. 目标与范围

在现有 PeerLink（P2P WebRTC IM + 文件传输）之上增加**实时语音通话**：一方拨打、另一方接听后，双向音频流经 `RTCPeerConnection` 音频轨实时传输。

与已有「语音消息」（录完即发的异步 blob）正交：语音消息走 DataChannel 当文件分片发；语音通话走 **MediaStream 音频轨**，实时传输。

### 范围边界（YAGNI，本期非目标）

视频通话、群通话（>2 人）、扬声器/输入设备切换、通话录音、网络质量指示条、通话最小化继续聊天。

## 2. 关键设计决策

1. **呼叫模型：电话式振铃**——一方拨打，另一方弹来电提示，可接听/拒绝；接听后才开始传音频。与现有文件 accept/reject 确认风格一致。
2. **信令路径（方案 A）**：
   - **呼叫控制**（invite/accept/reject/end）走**已连接的 DataChannel**，作为新控制消息，复用现有 `chat`/`voice-start` 同一套分帧机制。两端进房后 DataChannel 必然已连，复用零成本，符合「除 SDP/ICE 外一切 P2P」哲学。
   - **媒体协商**：接听后双方 `addTrack(麦克风)`，触发 **renegotiation**，新一轮 offer/answer 走信令服务 `signal` 透传（信令本职），ICE 复用。协议层（`packages/protocol/src/signaling.ts`）**不变**。
3. **renegotiation 由固定的「原始 PC initiator」一端发起 offer**，与本次通话由谁拨打无关 —— 规避双方同时 createOffer 的 glare 冲突。
4. **排他**：任意时刻只允许一路通话（`callState` 单一非 idle 实例）。
5. **能力检测**：本端拨打前自检麦克风；被叫端不支持/无麦克风/权限被拒时回带 reason 的 reject。
6. **UI 完整度：标准**——通话条含对方名、状态、计时、静音(mute)开关、连接状态指示、挂断；结束后时间线留记录。

## 3. 呼叫状态机

每端各持有一份，单一 `callState`：

```
idle ──本端拨打──▶ dialing ──收到 accept──▶ connecting ──协商完成/track 到达──▶ active
  ▲                  │                          │                                  │
  │           收到 reject/超时              ICE失败/断连                         本/对端 end
  └──────────────────┴──────────────────────────┴──────────────────────────────────┘
                                  （回 idle，时间线落一条记录）

idle ──收到 invite──▶ ringing ──本端接听──▶ connecting ─▶ active
                         │
                  本端拒绝/对端取消
                         └──▶ idle
```

- **不变式**：任意时刻 `callState` 只有一个非 idle 实例 —— 排他的根。
- 振铃超时 30s 未接 → 主叫记「未接听」，被叫记「未接来电」。

## 4. 协议扩展

`packages/protocol/src/control.ts` 新增 4 条控制消息（走 DataChannel），加入现有 union，`control.spec.ts` 补 round-trip 测试：

| type          | 方向      | payload          | 说明                                                                      |
| ------------- | --------- | ---------------- | ------------------------------------------------------------------------- |
| `call-invite` | 主叫→被叫 | `callId, ts`     | 发起呼叫；发出时主叫已 `addTrack` 本地麦克风                              |
| `call-accept` | 被叫→主叫 | `callId`         | 接听；被叫已 `addTrack`，触发 renegotiation                               |
| `call-reject` | 被叫→主叫 | `callId, reason` | 拒绝；`reason ∈ {declined, busy, unsupported, no-mic, permission-denied}` |
| `call-end`    | 任意      | `callId, reason` | 挂断/取消/失败；`reason ∈ {hangup, cancelled, timeout, failed}`           |

- `callId` 用现有 `nextFileId` 同源计数器生成，避免与 fileId/streamId 碰撞。
- SDP renegotiation 仍走 `signal` 透传，信令协议不变。

## 5. 排他、glare 与能力检测

### 排他（busy）

- 收到 `call-invite` 时若 `callState !== idle` → **不振铃**，立即回 `call-reject{ reason: 'busy' }`；主叫端 UI 显示「对方正在通话中」。
- 本端 `callState !== idle` 时 UI 禁用拨号键。

### 同时拨打的 glare 裁决

双方几乎同时 `call-invite` 时，确定性裁决——**原始 PC initiator 一端的呼叫胜出**：

- non-initiator 端在 `dialing` 时收到对方 invite → 取消自己的 dialing，转为 `ringing`（接听对方）。
- initiator 端收到对方 invite → 回 `reject{busy}`，保持自己的呼叫。

避免双方互相 busy 导致都失败。

### 能力检测

- **本端**拨打前探测 `navigator.mediaDevices?.getUserMedia` 存在且能取到麦克风。取不到 → 本地报错，不发 invite。
- **被叫端**收到 invite / 接听时探测：
  - API 不存在 → 回 `reject{unsupported}`
  - 有 API 但无麦克风设备 → 回 `reject{no-mic}`
  - 权限被拒 → 回 `reject{permission-denied}`
- 主叫端按 reason 显示：「对方设备不支持语音通话」/「对方无可用麦克风」/「对方拒绝了麦克风权限」/「对方拒绝接听」/「对方正在通话中」。

## 6. renegotiation 时序

```
主叫(A) 点拨打
  A: getUserMedia → pc.addTrack(mic)        // 先备好轨，暂不协商
  A → call-invite ─(DataChannel)→ B
B: callState=ringing，UI 来电弹层
B: 点接听 → getUserMedia → pc.addTrack(mic)
  B → call-accept ─(DataChannel)→ A
── 此刻两端都已 addTrack，由「原始 PC initiator」端发起单次协商 ──
  initiator 端: pc.createOffer → setLocal → signal(sdp)
  对端:        setRemote → createAnswer → setLocal → signal(sdp)
  双方 'track' 事件拿到对端音频流 → 挂到隐藏 <audio autoplay>
  callState=active，开始计时
```

- 两端协商前都已 addTrack，一次 offer/answer 即协商出**双向** sendrecv 音频，无需两轮。
- **挂断**：发 `call-end` → 两端 `track.stop()` + `removeTrack` → initiator 再 renegotiate 一次收掉 m-line → 回 idle。
- 谁发 offer 与谁拨打无关，永远 initiator 端。

## 7. 模块改动清单

| 模块                                            | 改动                                                                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/control.ts`              | 新增 4 条控制消息 zod schema + 加进 union；`control.spec.ts` 补测                                                                                                                                    |
| `apps/web/src/core/peer-connection.ts`          | 新增 `addLocalAudio(stream)` / `removeLocalAudio()`；`renegotiate()`（封装 createOffer→signal）；`onnegotiationneeded` 仅 initiator 响应；暴露 `onRemoteTrack` 回调                                  |
| `apps/web/src/core/call-session.ts`（**新建**） | 纯逻辑通话编排器：持有 `callState`、callId、计时、排他判定、glare 裁决、reason 路由。**不碰 DOM**，依赖注入「发控制消息」「取麦克风」「renegotiate」三个函数 → 纯逻辑 TDD                            |
| `apps/web/src/core/voice-recorder.ts`           | 抽出共用 `acquireMic()`（带能力/权限探测），语音消息与通话共用                                                                                                                                       |
| `apps/web/src/core/conversation.ts`             | 路由 4 条新控制消息进 `call-session`；接出 `onRemoteTrack`                                                                                                                                           |
| `apps/web/src/core/session-manager.ts`          | 串接 call-session 与 store；管理隐藏 `<audio>` 播放元素生命周期                                                                                                                                      |
| `apps/web/src/state/conversation-store.ts`      | 新增 `call` 切片（status/dir/callId/durationMs/muted/error）+ actions；时间线新增 `kind:'call'` 记录项（时长/未接/已取消/失败）                                                                      |
| `apps/web/src/features/chat/`                   | 新建 `CallPanel.tsx`（通话条：对方名、状态、计时、静音、挂断）+ `IncomingCallPrompt.tsx`（来电接听/拒绝）+ `CallRecordBubble.tsx`（时间线记录）；`Composer.tsx` 加「拨打」键（与语音消息麦克风区分） |

## 8. 错误与断连恢复

- **ICE 断连**（`connectionState` → `disconnected`/`failed`）：active 中显示「重连中」，约 8s 宽限；恢复则继续，超时则 `call-end{failed}` 收尾。
- **DataChannel 关闭**：直接判通话失败回 idle。
- **对端无应答**：主叫 30s 超时 → `call-end{timeout}`，记「未接听」。
- **页面刷新/会话销毁**：停所有轨、`revoke` 资源、callState 强制 idle（沿用现有 session 清理钩子）。

## 9. 测试策略

对齐项目 TDD 约定（纯逻辑 TDD，浏览器封装层 mock 验证调用契约，UI 不写渲染测试）：

- **纯逻辑 TDD**：
  - `call-session.spec.ts`：状态机全路径、排他回 busy、glare 裁决、reason 映射、超时；fake 注入函数断言调用契约。
  - `control.spec.ts`：新 schema 解析/round-trip。
- **mock 契约层**：`peer-connection.spec.ts` 用现有 `RTCPeerConnection` mock 验证 `addLocalAudio → renegotiate → signal` 调用序列与 `onRemoteTrack` 分发。
- **不写渲染测试**：项目无 testing-library，UI 由真实浏览器双开手测验证。
