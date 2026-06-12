# 语音消息设计（Voice Messages）

- 日期：2026-06-12
- 状态：已评审，待实现
- 范围：阶段一增量功能。**仅语音消息**（录完即发，非实时通话）。实时语音通话不在本次范围。

## 背景与目标

PeerLink 现有「统一时间线」承载对称的文字消息与文件传输，全部 P2P 直传、永不经过信令服务、纯会话内存阅后即焚。本功能在同一时间线里新增**语音消息**：一方录一段音频，作为时间线里的一条消息直接送达对方，对方点击播放。

设计原则与现有保持一致：

- **P2P 直传**：音频字节走 DataChannel，永不经过信令服务。
- **纯内存阅后即焚**：语音**不落盘**，收端在内存里拼回 Blob 生成 object URL，会话关闭即 revoke。
- **直接送达**：语音像文字一样直接出现在对方时间线，**无 accept/reject 确认**（区别于文件传输）。
- **复用而非污染**：复用最可靠的底层二进制分片 + CRC32 基础设施，但语音在编排器里是一条独立、干净的路径，不改动文件传输模型。

非目标（YAGNI）：实时通话、断点续传、语音转文字、真实波形可视化、`voice-cancel` 控制帧。

## 关键决策

| 决策点   | 选择                                      | 理由                                   |
| -------- | ----------------------------------------- | -------------------------------------- |
| 功能形态 | 语音消息（录完即发）                      | 与文件传输模型同构，复用度最高         |
| 送达确认 | 直接送达，无 accept/reject                | 语音消息「确认接收」体验过重           |
| 录音交互 | 桌面点击开始/结束，移动按住说话           | 按 `pointer: coarse` 切换，各端最优    |
| 传输机制 | 独立语音控制帧 + 复用数据帧分片（方案 B） | 复用可靠分片/CRC，又保持纯内存独立路径 |
| 最大时长 | 60 秒封顶                                 | 内存友好，符合 IM 场景                 |
| 存储     | 纯内存，object URL，会话关闭 revoke       | 阅后即焚                               |

## 架构总览

语音是与文字/文件**并行的独立维度**，但物理上仍走同一条 DataChannel：

```
录音(MediaRecorder) → Blob
  → conversation.sendVoice()
      → 发 voice-start 控制帧
      → 字节经数据帧 [0x01][streamId][chunkIndex][payload] 分片（复用 sender 背压）
      → 发 voice-complete{crc32} 控制帧
  → DataChannel →（对端）
      → voice-start: 建内存组装器 + 插入 receiving 占位气泡
      → 数据帧: 按 streamId 路由进组装器
      → voice-complete: 拼 Blob → 校验 CRC → object URL → 气泡转 ready
```

信令层**零改动**：SDP/ICE 协商不变，语音不引入新信令消息。

## 详细设计

### 1. 协议层 `packages/protocol`

`control.ts` 新增两个控制消息（zod schema）：

- `voice-start`：`{ type: 'voice-start', msgId: string, streamId: number, mimeType: string, durationMs: number, totalSize: number, ts: number }`
  - `mimeType`：收端构造 Blob 所需（如 `audio/webm;codecs=opus`）。
  - `durationMs`：气泡未播放时即可显示时长。
  - `totalSize`：组装与进度。
  - `streamId`：路由数据帧（承载在数据帧 `id` 字段）。
- `voice-complete`：`{ type: 'voice-complete', msgId: string, crc32: number }`
  - 触发收端对拼回字节做 CRC32 校验。

音频字节**复用现有数据帧格式** `[0x01][id: BE u32][chunkIndex: BE u32][payload]`（`frame.ts`），`id` 字段承载 `streamId`，分片大小复用现有 48KB 常量。

`constants.ts` 新增 `MAX_VOICE_DURATION_MS = 60_000`。

无 `voice-cancel`：取消都发生在发送前；发送中断连由现有 active-transfer 清理兜底。

改协议会同时影响两端，需同步 typecheck/test。

### 2. 录音层 `apps/web/src/core/voice-recorder.ts`（新）

封装 `getUserMedia({ audio: true })` + `MediaRecorder`：

- mimeType 选择：优先 `audio/webm;codecs=opus`，回退 `audio/ogg;codecs=opus`，再回退浏览器默认（用 `MediaRecorder.isTypeSupported` 探测）。
- 接口：`start()`、`stop(): Promise<{ blob, mimeType, durationMs }>`、`cancel()`。
- 内置 60 秒自动停止定时器。
- 暴露录音电平（用于 Composer 电平条），可用 Web Audio `AnalyserNode` 或 MediaRecorder 时间近似。
- 错误：拒权 / 无可用设备 抛类型化错误，供 UI toast。
- 停止后释放 `MediaStream` 轨道（`track.stop()`），避免麦克风常亮。

### 3. 发送 — `conversation.ts` 扩展

新增 `sendVoice(blob: Blob, mimeType: string, durationMs: number): VoiceItem`：

1. 分配 `msgId`（时间线项）与 `streamId`（从现有 `nextFileId` 计数器分配，避免与文件 id 撞号）。
2. 发 `voice-start` 控制帧。
3. 读 blob 为 `ArrayBuffer`，经现有数据帧分片，**复用 `sender.ts` 的背压逻辑**（`bufferedAmount` 控制，不重造）顺序发送。
4. 对全部字节算 CRC32，发 `voice-complete`。
5. 返回 `dir: 'out'` 的时间线项（初始 `status: 'sending'`，全部发完转 `ready`）。

### 4. 接收 — `conversation.ts` 扩展

- 收 `voice-start`：在 `voiceStreams: Map<streamId, VoiceAssembler>` 建组装器（缓存 chunks、期望 size、mimeType、duration、msgId）；时间线**立即插入 `receiving` 占位气泡**。
- 数据帧路由：handler **先查 `voiceStreams`**，命中则 append 进组装器；未命中再走现有 `fileIdToTransfer`（文件路径）。
- 收 `voice-complete`：按序拼成 `Blob` → CRC32 校验 → `URL.createObjectURL` → 气泡转 `ready`（带可播 url + durationMs）；CRC 不匹配 → 转 `failed`。**全程内存、不触碰 storage writer**。
- 清理：会话关闭 / 项被清除时 `URL.revokeObjectURL`；断连时清空未完成的 `voiceStreams` 并把对应气泡标 `failed`（接入现有 active-transfer 清理）。

### 5. 状态层 `apps/web/src/state/conversation-store.ts`

`TimelineItem` 新增变体：

```ts
| {
    kind: 'voice';
    id: string;
    dir: 'in' | 'out';
    status: 'sending' | 'receiving' | 'ready' | 'failed';
    durationMs: number;
    size: number;
    url?: string; // object URL，ready 时存在
    ts: number;
  }
```

新增 store actions：`appendVoice`、`setVoiceReady`、`setVoiceFailed`。`SessionManager`（`core/session-manager.ts`）新增 `sendVoice(sessionId, blob, mimeType, durationMs)`，并把接收回调（onVoiceStart 占位 / onVoiceReady / onVoiceFailed）接进 store。

### 6. UI — `apps/web/src/features/chat`

**Composer 新增麦克风按钮**，按 `matchMedia('(pointer: coarse)').matches` 切换交互模式：

- 桌面（细指针，tap-to-toggle）：点击麦克风进入录音态 → 显示计时 + 电平条 + 取消(✕)/发送(➤)两个控件 → 点发送调 `sendVoice`，点取消调 recorder.cancel。
- 移动（粗指针，hold-to-talk）：按住麦克风录音、松手发送、上滑/拖离取消。

**VoiceBubble（新组件）**：收发双向复用。播放/暂停按钮 + 时长 + 播放进度条；`sending`/`receiving` 显示 spinner，`ready` 可播（`<audio>` 接 object URL），`failed` 显示错误态。

波形：v1 仅做录音时电平条 + 播放进度条；真实波形 YAGNI，留后续。

样式遵循项目约定（Tailwind v4 标准 utility class、React 19 无 forwardRef）。

### 7. 错误处理

| 场景                | 处理                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| 麦克风拒权 / 无设备 | toast 提示，录音不启动                                                  |
| 浏览器不支持 Opus   | 回退 mimeType；彻底不支持 MediaRecorder 则禁用麦克风按钮并 tooltip 说明 |
| CRC 校验失败        | 收端气泡标 `failed`                                                     |
| 发送/接收中断连     | 复用现有 active-transfer 清理，连带清语音组装器并标 `failed`            |
| 超过 60 秒          | recorder 自动停止并发送                                                 |

### 8. 测试（Vitest，`*.spec.ts` 与源码共置）

- **protocol**（TDD）：`voice-start` / `voice-complete` schema 编解码往返、边界校验。
- **conversation**：
  - 发送：`sendVoice` 产出帧顺序正确（voice-start → data×N → voice-complete）。
  - 接收：组装 Blob + CRC 通过 → 触发 ready 回调，mimeType/duration 透传正确。
  - CRC 不匹配 → failed 回调。
  - **多路复用正确性**：语音与并发文件传输交错时，数据帧按 streamId/fileId 正确分流互不串扰。
- **voice-recorder**：mock `MediaRecorder` / `getUserMedia`，验证 start/stop/cancel、60 秒封顶、mimeType 选择、轨道释放、拒权错误。
- **UI**：轻量冒烟（Composer 模式切换、VoiceBubble 各 status 渲染）。

## 影响文件清单

新增：

- `apps/web/src/core/voice-recorder.ts`（+ spec）
- `apps/web/src/features/chat/VoiceBubble.tsx`

改动：

- `packages/protocol/src/control.ts`、`constants.ts`、`index.ts`（导出）
- `apps/web/src/core/conversation.ts`（sendVoice + 接收路由/组装）
- `apps/web/src/core/session-manager.ts`（sendVoice 透传 + 回调接线）
- `apps/web/src/state/conversation-store.ts`（voice TimelineItem + actions）
- `apps/web/src/features/chat/Composer.tsx`（麦克风按钮 + 录音态）
- `apps/web/src/features/chat/Timeline.tsx`（渲染 VoiceBubble）

信令层（`signaling-client.ts`、`apps/signaling`）：**零改动**。

## 部署提醒（非本次范围）

语音消息是「录完才发」的可靠传输，对 TURN 的依赖与文件传输完全一致——纯 STUN 在对称 NAT 下打洞失败时会发不出去。这点与现状一致，无需为语音额外配置。ICE 运行时注入（`STUN_URLS`/`TURN_*`）机制不变。
