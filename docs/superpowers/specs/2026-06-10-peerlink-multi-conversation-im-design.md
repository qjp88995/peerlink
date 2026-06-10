# PeerLink 多会话 IM 设计

> 状态：已评审待实现 · 日期：2026-06-10 · 范围：`apps/web` 为主，`packages/protocol` 与 `apps/signaling` 不改

## 背景与目标

当前 PeerLink 是严格的「单房间 / 单对单 / 单时间线」P2P 即时通讯：两端进同一房间，在一条统一时间线里互发文字与文件，纯内存阅后即焚。

本设计把它升级为 **多会话 IM**：左侧常驻会话列表，右侧当前会话详情，像微信/Telegram 那样**同时维护多条彼此独立的一对一会话**——**不是群聊**。一个联系人 = 一条独立的 P2P 房间，互不串扰。

### 已确认的范围决策

- **架构走"并行多房间"**（非"单房间多人群聊"）。
- **纯内存阅后即焚**：刷新即清空整个会话列表与消息。每条会话仍靠分享链接/二维码当场建立。
- **发起与加入双向汇入同一列表**：顶部 `[+]` 主动建会话，别人的链接 `/r/$roomId` 落地自动插入列表。
- **会话命名用房间 id 短码**（无账号、无昵称交换）。
- **掉线保留灰显 + 手动移除**：对方掉线时会话灰显保留，历史消息内存中可看，直到手动 × 或刷新。

### 非目标（阶段一 YAGNI）

断点续传、群聊（>2 人同房间）、账号/历史持久化、昵称交换协议、消息/列表持久化、自建 TURN、信令水平扩展。

## 核心架构：并行多房间

```
                       ┌─ Session A: ws──PeerConnection──DataChannel──Conversation ─→ peer A
   SessionManager ─────┼─ Session B: ws──PeerConnection──DataChannel──Conversation ─→ peer B
   (持有 N 个 handle)   └─ Session C: (等待加入，仅 ws + 房间，未接通)
```

- **一个会话 = 一个房间 = 一条独立 ws + 一个 `RTCPeerConnection` + 一条 `DataChannel` + 一个 `Conversation` 编排器**。会话之间完全隔离。
- 每条 ws 连接拿到独立 peerId，对应信令服务里一个独立的 2 人房间。因此：
  - **`apps/signaling` 一行不改**，`MAX_MEMBERS = 2` 保持不变。
  - **`packages/protocol` 一行不改**，DataChannel 仍严格 1-1，控制帧/数据帧无需加 peerId 或 conversationId。
- 最难、最易出错的 P2P/协议内核 **原样复用**，改动集中在 state 层与 UI 层。

### 明确不改的文件

- 整个 `packages/protocol`（signaling schema / control / frame / crc32）。
- 整个 `apps/signaling`（room-manager / server）。
- `apps/web/src/core/`：`conversation.ts`、`peer-connection.ts`、`signaling-client.ts`、`channel.ts`、`sender`、`receiver`、`storage`。
- `startConversation()` 按会话复用；唯一变化是它的回调在 SessionManager 调用处**绑定上 sessionId**（其自身签名可保持不变）。

> 每个 `Conversation` 实例自带独立的发送/接收状态与 storage receiver，多条会话并发收文件天然无冲突。

## 模块划分与职责边界

三层清晰隔离，各自可独立测试。

### ① Store —— 纯状态 + 纯 reducer（无副作用、不持有 handle）

重构 `apps/web/src/state/conversation-store.ts`（单会话 → 多会话）：

```ts
interface Session {
  id: string;              // 本地稳定 id（创建会话时生成）
  roomId: string | null;   // 信令分配后回填
  connection: Connection;  // 'connecting' | 'waiting' | 'connected' | 'closed'
  items: TimelineItem[];   // 本会话独立时间线
  shareUrl?: string;       // 建会话方在 waiting 状态下的分享链接
  unread: number;          // 非活跃会话来新消息时累加
}

interface RoomsState {
  sessions: Record<string, Session>;
  order: string[];         // 侧栏排序
  activeId: string | null;

  // 全部为纯 reducer，按 id 操作：
  createSession(id: string): void;          // mode=create
  joinSession(id: string, roomId: string): void; // mode=join
  removeSession(id: string): void;
  setActive(id: string | null): void;
  setConnection(id: string, c: Connection): void;
  setRoom(id: string, roomId: string, shareUrl?: string): void;
  appendText(id: string, ...): void;        // 非活跃会话同时 unread++
  appendFiles(id: string, ...): void;
  updateFileStatus(id: string, ...): void;
  clearUnread(id: string): void;
}
```

- `TimelineItem` 结构沿用现状（text / file，dir = out|in）。
- `appendText` / `appendFiles`：若目标 `id !== activeId`，同时 `unread++`。

### ② SessionManager —— 持有 handle + 所有副作用

新文件 `apps/web/src/core/session-manager.ts`，模块单例：

- 内部维护 `Map<sessionId, ConversationHandle>`。**不进 store**（handle 不可序列化、不应触发重渲染）。
- `create(): string` — 生成 sessionId，调 `store.createSession`，调 `startConversation({ mode: 'create' }, 回调绑定该 id)`，存 handle，返回 id。
- `join(roomId): string` — 同上但 `mode: 'join'`；若已存在指向同 roomId 的会话则直接返回其 id（去重）。
- `remove(id)` — `handle.close()` 关 PC+ws，删 map，调 `store.removeSession`。
- `sendText(id, …)` / `sendFiles(id, …)` — 路由到对应 handle。
- `closeAll()` — 页面卸载时 best-effort 关闭全部。

回调绑定：把 `startConversation` 的 `setRoom / setConnection / appendText / appendFiles / updateFileStatus` 回调全部 bind 上 sessionId，转发到 store 对应 reducer。

### ③ UI —— 动作走 SessionManager，渲染读 Store

`Timeline` / `Composer` / 分享面板保持 dumb，只接收「当前活跃会话的切片」作为 props。

### 边界与可测性

- Store 是纯函数集合 → 可独立单测。
- SessionManager mock 掉 `startConversation` → 验证调用契约。
- UI 不持有连接逻辑 → 组件测只覆盖渲染状态。

## UI 结构与数据流

新增常驻外壳 `apps/web/src/features/chat/Inbox.tsx`：左侧 `ConversationList` + 右侧 `ConversationView`。

```
┌────────────────┬─────────────────────────────┐
│ PeerLink    [+]│   会话 #3f9a · 已连接          │
│────────────────│─────────────────────────────│
│ ● #3f9a    1   │                              │
│   你好…      ●  │        ┌─ 对方气泡           │
│────────────────│        └─ 我的气泡            │
│ ○ #7c2e        │                              │
│   等待加入…     │                              │
│────────────────│─────────────────────────────│
│ ⊘ #a1b8  已断开×│  [ 输入框 ……………… ] [发送]    │
└────────────────┴─────────────────────────────┘
```

### `ConversationList`（侧栏）

- 遍历 `order` → `sessions[id]`，每项展示：
  - 短码名（roomId 短码；roomId 未分配时显示占位）。
  - 状态点：● 已连接(`connected`) / ○ 等待(`connecting`/`waiting`) / ⊘ 已断开灰显(`closed`)。
  - 未读数徽标、末条消息预览。
- 交互：点击 → `setActive(id)` + `clearUnread(id)`；× → `SessionManager.remove(id)`。
- 顶部 `[+]` → `SessionManager.create()`；旁边「粘贴链接/扫码」入口 → 解析出 roomId 后 `SessionManager.join(roomId)`。

### `ConversationView`（右侧）

- `activeId == null` → 空态引导（提示 `[+]` 或粘贴链接）。
- 会话 `waiting` 且为建会话方 → 分享面板（二维码 + 链接，复用现有组件）。
- `connected` 或已有消息 → `Timeline` + `Composer`，数据源为 `sessions[activeId]`。

### 后台不卸载

切换活跃会话**不拆**其它会话的连接，它们在后台继续接收，往各自切片 append，列表显示未读点。

## 路由、生命周期、错误处理

### 路由（TanStack file routes）

- 外壳常驻渲染 `Inbox`。
- `/r/$roomId` = 「确保存在指向该房间的加入会话并置为活跃」。别人的分享链接落地于此，自动插入列表（`SessionManager.join` 去重）。
- `[+]` 建会话：收到 `room-created` 拿到 roomId 后置 `waiting`、回填 `roomId`/`shareUrl`，并把 URL 同步到 `/r/$roomId`。
- 会话间切换主要走 store；同步更新 URL 以便分享与前进/后退。
- `/` = 空态（无活跃会话）。

### 生命周期

- **对方掉线**（`peer-left` / 连接断开）→ `setConnection(id,'closed')`，列表灰显保留，历史消息内存可看，直到手动 × 或整页刷新。
- **自己挂断** → 列表项 × → `SessionManager.remove(id)` 关 PC+ws 并删除。
- **整页关闭/刷新** → 纯内存，全部丢弃；`closeAll()` best-effort 关闭所有连接。

### 错误处理

- 单条会话的 ws/ICE 失败只影响该会话：标 `closed` + `sonner` toast，不波及其它会话。
- 房间满（`ROOM_FULL`）/ 不存在（`ROOM_NOT_FOUND`）→ 该会话项显示错误态。

## 测试策略

- **Store（TDD，纯逻辑，Vitest 同目录共置）**：create/join/remove/setActive；按 id 路由 append；非活跃会话 unread 累加与 `clearUnread` 清零；掉线灰显（`connection='closed'` 仍保留在 `sessions`/`order`）。
- **SessionManager（mock `startConversation`）**：按 id 起停 handle；`join` 同 roomId 去重；`send*` 路由到正确 handle；`remove` 正确 `close()` 并清理 map 与 store；回调正确绑定到对应 id 的 reducer。
- **UI（轻量组件测）**：`ConversationList` 各状态渲染（等待/已连接/已断开/未读徽标）。`Timeline`/`Composer`/分享面板逻辑未变，不重测。

## 影响文件清单

### 改动

- `apps/web/src/state/conversation-store.ts` — 单会话 → 多会话 `RoomsState`。
- `apps/web/src/features/chat/ChatRoom.tsx` — 拆解为 `Inbox` 外壳 + `ConversationView`。
- `apps/web/src/routes/index.tsx`、`apps/web/src/routes/r.$roomId.tsx` — 适配常驻外壳与活跃会话语义。
- 现有 `Timeline` / `Composer` / 分享面板 — 改为接收活跃会话切片 props（逻辑不变）。

### 新增

- `apps/web/src/core/session-manager.ts` — 多会话编排器（持有 handle）。
- `apps/web/src/features/chat/Inbox.tsx` — 左列表 + 右详情外壳。
- `apps/web/src/features/chat/ConversationList.tsx` — 侧栏。
- `apps/web/src/features/chat/ConversationView.tsx` — 右侧详情分发。
- 对应 `*.spec.ts`。

### 不动

- 整个 `packages/protocol`、整个 `apps/signaling`。
- `apps/web/src/core/`：`conversation.ts`、`peer-connection.ts`、`signaling-client.ts`、`channel.ts`、`sender`、`receiver`、`storage`。
