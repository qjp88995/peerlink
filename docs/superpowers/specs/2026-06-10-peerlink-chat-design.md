# PeerLink 改造：P2P 对话 + 文件传输（统一时间线 IM）

> 设计日期：2026-06-10
> 背景：将 PeerLink 从「单次收发文件」改造为「IM 形态的 P2P 对话 + 文件传输」。
> 关联：`docs/superpowers/specs/2026-06-08-peerlink-web-design.md`、`CLAUDE.md`。

## 目标与范围

把当前**非对称**的 发送方(`SendPanel`) / 接收方(`ReceivePanel`) 体验，改造为**对称**的即时通讯窗口：两端进入同一房间后，可在**统一时间线**里互发文字消息与文件，文件与文字都以「消息气泡」形式出现。

确定的产品决策（来自 brainstorming）：

1. **完全替换**为 IM 形态：文字消息与文件同处一条时间线。
2. **文件保留 accept/reject 确认握手**：对端发文件先出「接收/拒绝」气泡，确认后才开始传。
3. **纯会话内存**：刷新/断开即清空，不做任何本地或远端持久化（契合「阅后即焚」与现有无持久化哲学）。
4. **极简感知**：仅消息气泡 + 连接状态（已连接 / 对方已离开），不做送达回执、不做「正在输入」。

非目标（沿用阶段一 YAGNI 边界）：断点续传、多人(>2)、账号/历史持久化、自建 TURN、信令水平扩展、送达回执、输入指示。

## 核心技术挑战

`PeerConnection` 本身已对称（单条 DataChannel，`onMessage` 回调，两端均可 `send`）；「initiator/answerer」只是 WebRTC 协商层，不等于 app 角色。

但 `TransferSender` / `TransferReceiver` 是**单次、单方向**对象：sender 一次性 stream 一组文件，receiver 绑定一个 manifest，且依赖一个全局 `received` 计数与一个 `fileId` 命名空间。IM 时间线下会有**多次**文件发送（每次一个气泡），且两端可能各自在发——当前模型撑不住。

因此核心是：**在一条 DataChannel 上多路复用「多次文件传输 + 文字消息」**。方案：协议层给文件相关控制消息加 `transferId`、新增 `chat` 类型、`fileId` 升级为发送方会话内单调递增；新增对称编排器 `core/conversation.ts` 按 `transferId` / `fileId` 路由。**数据帧热路径不动。**

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│ features/chat/  ChatRoom · Timeline · Bubbles · Composer │  UI（对称）
├─────────────────────────────────────────────────────────┤
│ state/store.ts   connection + items[](统一时间线)         │  状态
├─────────────────────────────────────────────────────────┤
│ core/conversation.ts  对称编排：连接引导 + 帧路由 +        │  多路复用核心
│   出/入站文字 + 出/入站文件(多 transferId 并存)           │
├──────────────┬──────────────────┬───────────────────────┤
│ TransferSender│ TransferReceiver │ PeerConnection(对称)   │  传输内核（基本复用）
│ (每 transfer) │ (每 transfer)    │ SignalingClient        │
├──────────────┴──────────────────┴───────────────────────┤
│ @peerlink/protocol  control(+chat,+transferId) · frame   │  协议（唯一事实源）
│   (数据帧不变) · crc32                                    │
└─────────────────────────────────────────────────────────┘
```

## ① 协议层（`packages/protocol/src/control.ts`）

```ts
// 文字消息（新）
const chat = z.object({
  type: z.literal('chat'),
  msgId: z.string(), // 发送方生成，用于幂等/去重
  text: z.string().max(8192),
  ts: z.number().int(), // 发送方时间戳
});

// 文件相关消息统一加 transferId
const manifest = z.object({
  type: z.literal('manifest'),
  transferId: z.string(), // 新
  files: z.array(fileEntrySchema),
  totalSize: z.number().int().nonnegative(),
});
const accept = z.object({ type: z.literal('accept'), transferId: z.string() }); // +transferId
const reject = z.object({ type: z.literal('reject'), transferId: z.string() }); // +transferId
const fileComplete = z.object({
  type: z.literal('file-complete'),
  fileId: z.number().int().nonnegative(),
  crc32: z.number().int().nonnegative(),
});
const transferComplete = z.object({
  type: z.literal('transfer-complete'),
  transferId: z.string(),
}); // +transferId
const cancel = z.object({
  type: z.literal('cancel'),
  transferId: z.string(), // 新
  reason: z.string().optional(),
});

export const controlMessageSchema = z.discriminatedUnion('type', [
  chat,
  manifest,
  accept,
  reject,
  fileComplete,
  transferComplete,
  cancel,
]);
```

要点：

- **数据帧 `frame.ts` 完全不动**（仍 `[0x01][fileId BE][chunkIndex BE][payload]`）。
- `fileId` 语义升级为「**发送方在整个会话内单调递增**」，故 `file-complete` 用 `fileId` 即可唯一定位文件并回填到正确的 transfer，无需在数据帧塞 transferId。
- `accept` / `reject` 现带 `transferId`，因为同一会话可能有多个待确认传输。

## ② 多路复用核心（`core/conversation.ts`，替换 `lib/transfer-session.ts`）

一个**对称**编排器，两端共用。连接引导仍非对称，open 后对称。

```ts
startConversation(
  init: { mode: 'create' } | { mode: 'join'; roomId: string },
  cb: ConversationCallbacks
): Conversation
```

`Conversation` 对外方法：`sendText(text)`、`sendFiles(files: File[])`、`acceptTransfer(transferId)`、`rejectTransfer(transferId)`、`close()`。

`ConversationCallbacks`（全部带 `transferId`/`msgId`，store 精确更新对应气泡）：
`onRoom(roomId)`、`onConnection(state)`、`onText(item)`、`onIncomingFiles(transferId, files, totalSize)`、`onProgress(transferId, sent, total)`、`onFileResult(transferId, fileId, ok)`、`onTransferDone(transferId)`、`onTransferFailed(transferId, reason?)`。

职责：

1. **连接引导**：
   - `create` → `createRoom` → `peer-joined` → `startAsInitiator`；
   - `join` → `joinRoom` → `signal` → `acceptOffer`。
   - 通道 `open` → `onConnection('connected')`。**不再自动发 manifest。**
2. **出站文字**：`sendText` 生成 `msgId`+`ts` → 发 `chat` 控制帧 → 本地立即乐观回显（`onText` dir:'out'）。
3. **出站文件**：`sendFiles` 生成 `transferId`，为每个文件分配会话内单调递增 `fileId`，发 `manifest{transferId}`，登记 `outgoing`。收到 `accept{transferId}` → `new TransferSender(...).streamAll()`（`onProgress` 节流）；收到 `reject{transferId}` → 气泡标 `rejected`。
4. **入站帧路由**（单一 `onMessage` 按帧分发）：
   - `control: chat` → `onText`（dir:'in'）。
   - `control: manifest` → 登记 `pending` 入站传输 + 记录其 `fileId` 集合，`onIncomingFiles(...)`。
   - `control: file-complete` → 按 `fileId` 路由到对应 `TransferReceiver`。
   - `control: transfer-complete{transferId}` → 对应 receiver `finish()` → `onTransferDone`。
   - `control: cancel{transferId}` → 对应 receiver `abort()` → `onTransferFailed`。
   - `data` 帧 → 按 `fileId→transferId` 映射查 receiver 并 `handleFrame`；查不到则丢弃 + `console.warn`。
5. **入站文件确认**：
   - `acceptTransfer(transferId)` → `makeWriter(files)`（FS Access / Blob 选择逻辑从 `transfer-session.ts` 原样搬来）→ `new TransferReceiver(...)` 注册进路由表，并把该 manifest 的 fileId 写入 `fileId→transferId` → 回发 `accept{transferId}`。
   - `rejectTransfer(transferId)` → 回发 `reject{transferId}`，清理 pending。

内部状态：`outgoing: Map<transferId, {...}>`、`incoming: Map<transferId, TransferReceiver>`、`fileIdToTransfer: Map<fileId, transferId>`、出站 `nextFileId` 单调计数。

## ③ 状态 + UI

### Store（`state/store.ts` 重写）

```ts
type Connection =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error';

type FileStatus =
  | 'awaiting-accept'
  | 'transferring'
  | 'done'
  | 'rejected'
  | 'failed'
  | 'canceled';

type TimelineItem =
  | {
      kind: 'text';
      id: string /*msgId*/;
      dir: 'out' | 'in';
      text: string;
      ts: number;
    }
  | {
      kind: 'file';
      id: string /*transferId*/;
      dir: 'out' | 'in';
      files: FileEntry[];
      totalSize: number;
      status: FileStatus;
      sent: number;
    };

interface ConvState {
  connection: Connection;
  roomId: string | null;
  items: TimelineItem[]; // 唯一时间线，文字+文件按到达顺序
  errorMessage: string | null;
  // actions:
  setConnection(s: Connection): void;
  setRoom(id: string): void;
  appendText(item): void;
  appendOutgoingFiles(transferId, files, totalSize): void; // 初始 status: 'awaiting-accept'(等对端 accept)，accept 后转 'transferring'
  appendIncomingFiles(transferId, files, totalSize): void; // 初始 status: 'awaiting-accept'(等本端确认)
  updateFileStatus(transferId, status): void;
  updateFileProgress(transferId, sent): void;
  reset(): void;
}
```

进度走 `updateFileProgress(transferId, sent)`，按 id 精确改对应气泡；不再有全局单进度。

### UI（`features/` 重构）

- 删除 `features/send/SendPanel.tsx`、`features/receive/ReceivePanel.tsx`。
- 新增 `features/chat/`：
  - `ChatRoom.tsx` — 容器：持有 `Conversation` ref，订阅 store，串接全部回调；传入 `mode`/`roomId`。
  - `Timeline.tsx` — 渲染 `items`，按 `kind`+`dir` 分发气泡。
  - `TextBubble.tsx` — 文字气泡（左/右对齐区分 in/out）。
  - `FileBubble.tsx` — 文件气泡：进度条、状态徽标；入站待确认时显示「接收 / 拒绝」按钮（不兼容接收端显示禁用态 + 原因，复用 `decideWriter` 门控）；完成后按 writer 类型显示「保存 / 下载」。
  - `Composer.tsx` — 底部输入框 + 发送按钮 + 文件选择（📎，复用现有 file/directory picker）；Enter 发送文字，`maxLength=8192`；`connection !== 'connected'` 时禁用。
- `features/share/RoomShare.tsx` 复用：连接前展示房间链接/二维码。
- `features/common/*` 复用。

### 路由

- `routes/index.tsx` — 入口：建房，`mode: 'create'`，渲染 `ChatRoom`。
- `routes/r.$roomId.tsx` — `mode: 'join'`，渲染同一 `ChatRoom`。
- 两路由仅入参不同，复用同一组件。

## ④ 错误处理与边界

- **对端离开**：`iceconnectionstatechange` → `disconnected`/`failed`/`closed` → `connection: 'closed'`；时间线保留（纯内存）；Composer 禁用并提示「对方已离开」；进行中传输气泡标 `failed`。
- **传输中途断开**：对应气泡 `failed`，writer `abort()`（FS Access 删半成品 / Blob 丢弃）。
- **CRC 校验失败**：沿用 `onFileResult(fileId, ok)`，气泡标该文件校验失败。
- **接收端不兼容**（多文件/目录但无 FS Access）：入站气泡禁用态 + 原因，`acceptTransfer` 防御性 reject。
- **文字超长**：`text.max(8192)`，Composer 同步限制；控制帧解析失败则忽略 + `console.warn`，不崩会话。
- **未知/乱序 `fileId` 数据帧**：路由表查不到即丢弃 + `console.warn`。

## ⑤ 测试（Vitest，`*.spec.ts` 同目录共置）

- **协议（TDD，纯逻辑）** `control.spec.ts`：`chat` 消息、带 `transferId` 的 manifest/accept/reject/transfer-complete/cancel 的 schema 往返与非法输入拒绝。
- **`core/conversation.spec.ts`（核心，mock DataChannel）**：
  - 文字往返：`sendText` 发出正确控制帧；入站 `chat` 帧触发 `onText`。
  - 文件握手：`sendFiles` 发 `manifest`（带 transferId、单调 fileId）；模拟入站 `accept` 后开始 stream；`reject` 标记气泡。
  - 多路复用：两个 transferId 并存，data 帧按 `fileId→transferId` 路由到正确 receiver；交错文字不串台。
  - 断开：连接状态回调 + 进行中传输标 failed。
- **`core/sender.spec.ts` / `core/receiver.spec.ts`**：随 `transferId` 签名调整跟改；核心流式逻辑不变。
- **`state/store.spec.ts`**：时间线 append / 按 id 更新进度与状态流转。
- **UI**：沿项目约定，浏览器 API 封装层 mock 验证调用契约；真实手测由用户在浏览器完成。

## 影响面清单

| 路径                                                     | 改动                                           |
| -------------------------------------------------------- | ---------------------------------------------- |
| `packages/protocol/src/control.ts`                       | 加 `chat`、文件消息加 `transferId`             |
| `packages/protocol/src/control.spec.ts`                  | 补测                                           |
| `apps/web/src/core/conversation.ts`                      | **新增**（替换 `lib/transfer-session.ts`）     |
| `apps/web/src/lib/transfer-session.ts`                   | **删除**                                       |
| `apps/web/src/core/sender.ts` / `receiver.ts`            | `transferId` 适配，逻辑复用                    |
| `apps/web/src/state/store.ts`                            | 重写为时间线模型                               |
| `apps/web/src/features/chat/*`                           | **新增**（ChatRoom/Timeline/Bubbles/Composer） |
| `apps/web/src/features/send/*` · `receive/*`             | **删除**                                       |
| `apps/web/src/routes/index.tsx` · `r.$roomId.tsx`        | 渲染 `ChatRoom`                                |
| `apps/web/src/features/share/RoomShare.tsx` · `common/*` | 复用                                           |
