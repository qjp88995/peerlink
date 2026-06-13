# 会议模式（双人）+ 屏幕共享 设计

> 状态：已与用户对齐，待评审。
> 日期：2026-06-13

## 背景与定位

PeerLink 明确定位为 **1v1 双人 P2P** 即时通讯系统，多人会议是另一个物种（mesh / 星型 / SFU 都需突破 `MAX_MEMBERS=2` 与「无媒体服务器」立项），**若将来要做多人，新开项目**，本仓库不引入多人逻辑。

「会议模式」在双人场景下 = 语音 + 文字 + 屏幕共享 三件能力的打包。其中：

- **文字**：已有（chat 时间线），会议期间照常可用。
- **语音**：已有（`call-session` + WebRTC 音频轨）。
- **屏幕共享**：本设计唯一真正新增的能力。

## 已确认的需求决策

1. **会议取代通话**：只保留一个「开会议」入口，复用 `call-session`。接通后默认语音，随时可开/关「共享屏幕」。原来的纯语音通话 = 「没开屏幕的会议」。
2. **演示者模型**：一次只有一个演示者。任一方可发起共享。
3. **接管冲突**：对方正在共享时，本端「共享」按钮**置灰/禁用**，需对方先停止才能共享（状态机最简，无竞态）。
4. **屏幕音频**：**只传画面**，不传被共享标签页/系统音频。语音仍走麦克风轨。

## 核心技术约束

`call-session` 用**「固定 initiator 端发起 renegotiation」**避免 glare（`peer-connection.renegotiate()` 仅由原始 initiator 调用）。语音能两端同时加 mic 轨，是因为音频是一条**双向 m-line**，对称。

屏幕共享是**非对称**的——同一时刻只有一方推视频。若**非 initiator 想共享**，它自己不能发起 offer，必须由 initiator 那端来协商。这是整个设计的核心，决定了 renegotiation 时序（见下文第 4 节）。

## 架构方案

复用 `call-session` 作为语音核心（几乎不动），新增独立薄模块 `screen-share.ts` 管理「谁在演示 + 一条可复用的视频 transceiver」。两个正交关注点（通话生命周期 vs 谁在演示）各自独立、各自可测，`call-session` 纯净不被污染。

### 1. 协议层（`packages/protocol/src/control.ts`）

新增两个控制帧，与 `call-*` 平级，走同一条 DataChannel：

```ts
const screenStart = z.object({
  type: z.literal('screen-start'),
  callId: z.number().int().nonnegative(), // 绑定当前会议，防串话
});
const screenStop = z.object({
  type: z.literal('screen-stop'),
  callId: z.number().int().nonnegative(),
});
```

加入 `controlMessageSchema` 的 discriminated union。**发送方即演示者**，帧内无需 presenter 字段。`callId` 复用 `call-session` 当前会议的 id，确保屏幕共享只在会议存续期内有效。

### 2. `peer-connection.ts`：一条可复用的 video transceiver

```ts
private videoTransceiver?: RTCRtpTransceiver;

/** 我开始演示：挂上屏幕轨，方向 sendonly。 */
setScreenTrack(track: MediaStreamTrack): void
/** 对方要演示前（仅 initiator 调）：预置 recvonly 收口。 */
prepareRecvVideo(): void
/** 停止演示（任意一方）：卸轨，方向 inactive。 */
clearScreenTrack(): void
```

底层用 `addTransceiver('video', { direction })` 懒创建一次，之后只改 `transceiver.direction` + `sender.replaceTrack(track | null)`。**始终一条 m-line**，避免 SDP m-line 累积。因为永远只有一个演示者、一路视频流，一条 transceiver 足够。

### 3. `screen-share.ts`：新的薄状态模块

纯逻辑，与 `call-session` 同构、可独立单测（`*.spec.ts` 同目录共置）。

```ts
type ScreenState = 'none' | 'local' | 'remote'; // 没人 / 我在演示 / 对方在演示

type ScreenControl =
  | { type: 'screen-start'; callId: number }
  | { type: 'screen-stop'; callId: number };

interface ScreenShareDeps {
  isInitiator: boolean;
  sendControl: (m: ScreenControl) => void;
  acquireDisplay: () => Promise<MediaStream>; // getDisplayMedia({ video: true })
  setScreenTrack: (t: MediaStreamTrack) => void;
  prepareRecvVideo: () => void;
  clearScreenTrack: () => void;
  renegotiate: () => Promise<void>;
  getCallId: () => number | null; // 取 call-session 当前 callId
  callbacks: {
    onStateChange?: (s: ScreenState) => void;
    onError?: (reason: 'permission-denied' | 'unsupported') => void;
  };
}
```

- 本端动作：`start()` / `stop()`。
- 远端：`onControl(screen-start | screen-stop)`。
- 守卫：`state === 'remote'` 时 `start()` 直接拒绝（对应 UI 按钮置灰），保证「一次一个演示者」。
- `getDisplayMedia` 抛错（用户取消/无权限）→ `onError`，状态回 `none`。

### 4. Renegotiation 时序（核心）

| 场景                                     | 流程                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **initiator 演示**                       | `getDisplayMedia` → `setScreenTrack`(sendonly) → `renegotiate()` → 发 `screen-start`                                                                                                          |
| **initiator 端，对方演示**               | 收 `screen-start` → `prepareRecvVideo()`(recvonly) → `renegotiate()` → `onRemoteTrack` 收视频                                                                                                 |
| **非 initiator 演示**                    | `getDisplayMedia` → `setScreenTrack` → **发 `screen-start`**（本端不能 renegotiate）→ initiator 收到后 `prepareRecvVideo()` + `renegotiate()` → 本端在 answer 把屏幕轨挂到该 m-line(sendonly) |
| **非 initiator 端，对方(initiator)演示** | 收 `screen-start` → 等 initiator 的 offer，answer 即可                                                                                                                                        |
| **停止（任意方）**                       | `clearScreenTrack` + 发 `screen-stop`；由 initiator 触发一轮 renegotiate 把 m-line 收回 inactive                                                                                              |

复用 `call-session.accept()` 里「非 initiator 改媒体 → initiator renegotiate」同款套路，只多了「对方演示前先 `prepareRecvVideo` 开 recvonly 收口」一步。

### 5. `conversation.ts` 接线

- 控制帧路由 switch（现 399–403 行附近）增加 `screen-start` / `screen-stop` → `screenShare.onControl`。
- `handleRemoteTrack` 按 `track.kind` 分流：`audio` → `call-session`（现状），`video` → 新增 `onRemoteScreenTrack` 回调给 UI。
- 实例化 `ScreenShare`，`getCallId` 从 `call-session` 取当前值。
- 会议结束（`call.finish` 路径）一并复位 `screenShare` + `clearScreenTrack`。

### 6. UI（`CallPanel.tsx` → 会议面板）

- 文案统一为「会议」：入口按钮「开会议」、面板标题等。
- 通话中新增「共享屏幕」按钮：
  - `state === 'remote'`：**置灰**并提示「对方正在共享」。
  - `state === 'local'`：变「停止共享」。
- `state !== 'none'` 时渲染 `<video autoplay>` 显示屏幕流：`local` 时**显示演示者自己的预览**（不只放状态条），`remote` 时显示对端画面。
- **为后续涂鸦/标记预留结构**：屏幕画面包在一个定位容器里（`<video>` 在底层，预留一层可叠加的 `<canvas>` 标记层位置），两侧像素对齐。本期不实现涂鸦，但容器结构按「视频 + 叠加层」组织，将来叠 canvas 不返工。
- 监听屏幕轨 `track.onended`（浏览器原生「停止共享」条）→ 自动走 `stop()`。

## 边界（对齐既有约定）

- **阅后即焚**：屏幕流是实时媒体轨，不落盘、不进时间线，天然符合「纯会话内存」。会议结束时间线只留一条现有 `CallRecord`，屏幕共享不单独记录（YAGNI）。
- **不传屏幕音频**：`getDisplayMedia({ video: true })`，不取 audio 轨。
- **`MAX_MEMBERS=2` / 协议 1-1 不变**：全程不碰信令房间模型，只在既有 P2P 连接上加一条视频轨。

## 测试策略

- `packages/protocol`：新控制帧 zod 解析/编解码走 TDD（与现有 `control.spec.ts` 同风格）。
- `screen-share.spec.ts`：纯逻辑状态机，mock deps 验证四种 renegotiation 时序与守卫（按钮置灰、getDisplayMedia 失败回退）的调用契约。
- `peer-connection`：mock `RTCPeerConnection`，验证 transceiver 方向翻转与 `replaceTrack` 调用契约。
- UI：不写渲染测试（apps/web 无 testing-library），仅纯逻辑/mock。

## 非目标（YAGNI）

- 多人会议（>2）——将来新开项目。
- **屏幕共享上的涂鸦/标记**——下一期做。本期不实现，但 UI 渲染结构（视频 + 可叠加层容器）需为其预留位，避免返工。涂鸦笔迹走已有 DataChannel P2P 同步，届时新增同构的 `annotation` 模块即可，不破坏现有架构。
- 屏幕音频/系统音频共享。
- 双方同时共享。
- 屏幕录制、画质/帧率档位、区域选择、远程控制。
- 屏幕共享落时间线/历史。
