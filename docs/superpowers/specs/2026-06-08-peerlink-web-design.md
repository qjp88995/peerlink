# PeerLink — 阶段一 Web 版设计文档

- **日期**:2026-06-08
- **状态**:已通过设计评审，待写实现计划
- **范围**:阶段一 = Web 版 P2P 文件传输。App / 微信小程序 / 自建 TURN 为后续独立 spec。

---

## 1. 背景与目标

做一个基于 **WebRTC** 的 P2P 文件传输系统。文件在两台设备的浏览器间 **点对点直传，不经过服务器**。

长期愿景包含 Web、原生 App、微信小程序三端。其中：

- **网页 / App** 可使用标准 WebRTC（`RTCPeerConnection` + DataChannel）。
- **微信小程序不支持标准 WebRTC**，注定需要"服务器中转"或单独的传输层，因此独立成后续 spec。

故按阶段推进，本 spec 只覆盖阶段一 Web 版：

- **阶段一（本 spec）**：Web 版，支持局域网自动发现 + 跨网络链接配对。
- **阶段二（后续）**：App，复用本阶段信令服务与协议包，换原生 WebRTC 库。
- **阶段三（后续）**：微信小程序，走服务器中转传输，复用信令/房间逻辑。
- **阶段 1.5（后续，可并行）**：自建 TURN 服务器，独立 spec。

### 阶段一已确认需求

- **平台**：Web 版，技术栈 React 19 + Vite + Tailwind v4。
- **连接方式**：
  1. 同局域网自动发现设备并发起传输（类 Snapdrop）。
  2. 跨网络通过 链接 / 二维码 / 短口令 配对（类 ShareDrop）。
- **传输能力**：多文件 + 整个文件夹（保留目录结构）+ GB 级大文件流式落盘。
- **ICE 配置**：默认公共 STUN；TURN 地址可在前端/部署侧配置（可插拔）。自建 TURN 不在本 spec。
- **传输通道**：WebRTC DataChannel。

---

## 2. 整体架构

### 2.1 Monorepo 结构（pnpm workspace）

```
peerlink/
├── apps/
│   ├── web/                  # React 19 + Vite + Tailwind v4 前端
│   └── signaling/            # Node WebSocket 信令服务
├── packages/
│   └── protocol/             # 共享 TS 类型：信令消息 + 文件分片协议
├── pnpm-workspace.yaml
└── package.json
```

### 2.2 运行时角色

```
        ┌─────────────┐   WebSocket(信令)   ┌─────────────┐
        │  发送端浏览器  │◄──────────────────►│             │
        │  (web app)   │                    │  信令服务    │
        └──────┬──────┘                     │ (signaling) │
               │                            │             │
               │      WebSocket(信令)        └──────▲──────┘
               │                                   │
               │      ┌─────────────┐              │
               └─────►│ 接收端浏览器  │◄─────────────┘
   WebRTC DataChannel │  (web app)   │
   (P2P 直传,不过服务器) └─────────────┘
```

### 2.3 设计原则

1. **信令与传输彻底分离**。信令服务只做撮合（交换 SDP/ICE、局域网分组），**文件数据永不经过它**。信令服务保持轻量、低带宽、近无状态，便于后续 App / 小程序复用。
2. **`packages/protocol` 是唯一事实源**。所有信令消息格式、文件分片帧格式定义于此，前端与信令服务共享同一套 TS 类型，避免两端协议漂移。
3. **客户端内部分层**（`apps/web` 内）：
   - `signaling-client` — WebSocket 连接与信令收发。
   - `peer-connection` — 封装 `RTCPeerConnection`、ICE、DataChannel 建立。
   - `transfer` — 文件分片、背压控制、组装（发送/接收两端）。
   - `storage` — 接收端写入抽象（File System Access / StreamSaver / ZIP / 内存 Blob）。
   - `ui` — React 组件。

   每层职责单一、接口清晰、可独立测试。后续 App 可替换 `storage` / `ui`，复用 `protocol`、`transfer`、`peer-connection`、`signaling-client`。

### 2.4 部署形态

- `apps/web`：纯静态站点，可部署到 Vercel 或任意静态托管。
- `apps/signaling`：常驻 Node 进程，小实例即可。

---

## 3. 信令协议与房间 / 局域网发现模型

### 3.1 房间模型（跨网络配对）

- 发送端连上信令服务 → `create-room` → 返回随机短码 `roomId`。
- 基于 `roomId` 生成三种入口（指向同一房间）：
  - **链接**：`https://<host>/#/r/<roomId>`
  - **二维码**：对上面链接编码。
  - **短口令**：`roomId` 设计为易读形式（如 `4 位数字 + 1 个词`，例：`8423-河马`），便于手输。
- 接收端任选一种入口，携带 `roomId` 连上信令服务 → `join-room`。
- 房间满 2 人即触发 WebRTC 协商。房间短时有效（默认 10 分钟无人加入自动回收），配对成功后可关闭。

### 3.2 局域网自动发现

- 信令服务按**来源公网 IP** 分组（同出口 IP ≈ 同局域网）。
- 客户端连上后，服务推送"同局域网在线设备列表"（每设备随机昵称/图标）。
- 点选某设备 → 对其发起配对（内部复用房间撮合，`roomId` 由服务临时分配，用户无需输码）。
- **已知局限**：大出口 NAT 下可能误把陌生人分到一组。故局域网模式仅用于"发现 + 发起"，真正传输前接收方必须**显式点"接受"**，并显示对方设备名，避免误传。

### 3.3 信令消息协议（定义在 `packages/protocol`）

所有消息为带 `type` 字段的 JSON。

| 方向 | type | 载荷 | 用途 |
|------|------|------|------|
| C→S | `create-room` | — | 创建房间 |
| S→C | `room-created` | `roomId` | 返回房间码 |
| C→S | `join-room` | `roomId` | 加入房间 |
| S→C | `peer-joined` / `peer-left` | `peerId` | 对端进出通知 |
| S→C | `lan-peers` | `[{peerId, name}]` | 局域网设备列表（增量更新） |
| C→S | `lan-invite` | `targetPeerId` | 邀请某局域网设备 |
| C↔S↔C | `signal` | `{ sdp \| candidate }` | 转发 SDP offer/answer 与 ICE candidate |
| S→C | `error` | `{ code, message }` | 房间不存在/已满/超时等 |

- **`signal` 为核心透传通道**：服务不解析 SDP/ICE 内容，仅按 `roomId` / `peerId` 转发给对端。
- **心跳**：WebSocket ping/pong 保活与掉线检测；掉线即广播 `peer-left`。

### 3.4 信令服务状态

- 全部内存：`Map<roomId, Room>`、`Map<ipGroup, Set<client>>`。**无数据库**（房间临时）。
- 单实例起步。水平扩展（Redis 跨实例房间路由）作为预留扩展点，本阶段不实现。

---

## 4. 文件传输协议（分片 / 背压 / 流式落盘）

DataChannel 建立后所有文件数据走它，**不经信令服务**。

### 4.1 一次传输流程

```
发送端                                          接收端
  │  ① manifest(文件清单:id/名/大小/相对路径)          │
  │ ──────────────────────────────────────────────► │
  │                                                  │ 展示文件树,用户点"接受"
  │  ② accept / reject                               │
  │ ◄────────────────────────────────────────────── │
  │                                                  │ 准备写入目标(选目录 / ZIP)
  │  ③ 逐文件、逐块发送:[chunk header][binary data]   │
  │ ──────────────────────────────────────────────► │ 按 header 路由到文件,流式写入
  │  ④ file-complete(校验)                           │
  │ ──────────────────────────────────────────────► │
  │           ...所有文件传完...                        │
  │  ⑤ transfer-complete                             │
  │ ──────────────────────────────────────────────► │ 收尾(关闭句柄 / 生成 zip 下载)
```

### 4.2 分片协议（定义在 `packages/protocol`）

DataChannel 上两类帧，用首字节区分：

- **控制帧（JSON）**：`manifest` / `accept` / `reject` / `file-complete` / `transfer-complete` / `cancel`。
- **数据帧（二进制）**：`[1 字节类型][定长头: fileId + chunkIndex][数据负载]`。

参数：

- **块大小**：默认 **16 KB**（跨浏览器最安全）；建连后探测 `RTCDataChannel.maxMessageSize`，可更大则调到 64 KB 提速。
- **数据帧头**：定长二进制头（fileId + chunkIndex），避免每块发 JSON 的开销。

### 4.3 背压控制

发送端核心循环：

- 设 `bufferedAmountLowThreshold`（如 256 KB）。
- `dataChannel.bufferedAmount` 超过高水位（如 1 MB）→ 暂停发送。
- 监听 `bufferedamountlow` 事件 → 缓冲降下后继续。
- 用 `File.slice()` 流式读取，仅读即将发送的一小段，不把整个文件读入内存。

### 4.4 接收端写入抽象（`storage` 层）

统一接口（概念）：`createWriter(manifest) → { writeChunk(fileId, data), closeFile(fileId), finish() }`。

| 实现 | 适用 | 行为 |
|------|------|------|
| **File System Access** | Chromium 系 | 用户选目标目录，自动建子目录，边收边写硬盘，任意大小、原样还原文件夹 |
| **StreamSaver** | 不支持上者但需大单文件 | 通过 Service Worker 触发流式下载，边收边落盘 |
| **ZIP 流式打包** | Safari/Firefox 传文件夹/多文件 | 用 zip.js 流式压缩，下载一个 .zip，不全攒内存 |
| **内存 Blob（兜底）** | 小单文件 | 攒齐一次性下载 |

启动时探测浏览器能力选最优实现；UI 据此提示最终保存形式。

### 4.5 完整性校验

- 每文件传完发 `file-complete`，带该文件大小与校验和。
- 校验和用 **CRC32**（增量计算，快且够用）；接收端比对，不一致则该文件标记失败。

### 4.6 进度与取消

- 接收端按"已写字节 / 总字节"算每文件 + 总进度，回报 UI。
- 任意一方可发 `cancel`，双方清理写入句柄与缓冲。

---

## 5. 错误处理与边界情况

### 5.1 连接阶段

| 情况 | 处理 |
|------|------|
| 信令服务连不上 | 指数退避自动重连；UI 显示"正在连接服务…"，重试 N 次后提示失败 |
| 房间不存在 / 已过期 | `error{ROOM_NOT_FOUND}`，提示"链接已失效，请对方重新生成" |
| 房间已满 | `error{ROOM_FULL}`，提示"该房间已被占用" |
| WebRTC 协商 / ICE 全失败（严格 NAT 且无 TURN） | 检测 `iceConnectionState=failed` → 明确提示"无法建立直连，可能需要配置 TURN 服务器" |
| 配对中对方关闭页面 | 收到 `peer-left` → 提示"对方已断开" |

### 5.2 传输阶段

| 情况 | 处理 |
|------|------|
| 传输中 DataChannel 断开 | 标记中断，清理写入句柄；提示中断（本阶段不做断点续传，需重传整个任务） |
| 接收端拒绝 / 取消 | 发送端停止读取与发送，释放资源 |
| 文件校验和不匹配 | 该文件标红，允许重试任务 |
| 接收端选目录失败 / 无写入权限 | 回退到下一可用 `storage` 实现（如 ZIP），或提示用户 |
| 误用内存 Blob 传大文件 | 能力探测时即避免该路径；manifest 阶段若总大小超阈值且无流式能力，提前警告 |

### 5.3 浏览器兼容与降级

- 启动探测：`RTCPeerConnection`、`File System Access`、Service Worker（StreamSaver）、`webkitdirectory`。
- 不支持 WebRTC → 提示"当前浏览器不支持，请用新版 Chrome/Edge/Safari"。
- 文件夹接收按 4.4 能力矩阵自动降级，UI 明确告知最终保存形式。

### 5.4 安全与隐私

- 数据 P2P 直传不经服务器；服务器只见信令（SDP/ICE/房间码），看不到文件内容。
- WebRTC DataChannel 默认 **DTLS 加密**。
- 房间码随机且短时有效；局域网模式靠"显式接受 + 显示设备名"防误传。
- 信令服务对消息做基本校验与限流，不信任客户端字段。

### 5.5 阶段一非目标（YAGNI）

- ❌ 断点续传 / 传输恢复
- ❌ 多人（>2）同时传输 / 群发
- ❌ 账号 / 历史记录 / 持久化
- ❌ 自建 TURN（另立 spec）
- ❌ 信令服务水平扩展（预留 Redis 扩展点，不实现）

---

## 6. 测试策略

WebRTC/浏览器 API 难纯单元测试，故分层：纯逻辑尽量纯测，浏览器/网络相关用集成 + E2E。

### 6.1 `packages/protocol` — 单元测试（TDD，覆盖最高）

- 信令消息编解码 / 校验（合法与非法输入）。
- 分片帧编解码：数据帧头（fileId + chunkIndex）打包/解包往返一致；控制帧 JSON 往返。
- CRC32 校验和对已知向量的正确性。

### 6.2 `apps/signaling` — 单元 + 集成测试

- **单元**：房间状态机（创建/加入/满员/超时回收）、局域网分组（按 IP 分组、增量列表）。
- **集成**：起真实 WebSocket 服务，模拟两端走完"创建→加入→signal 转发→peer-left"，断言转发正确、不解析 SDP、错误码正确。

### 6.3 `apps/web` 各层 — 单元测试 + mock

- `transfer`：DataChannel 抽象为接口，用 mock channel 测分片循环、背压（模拟 `bufferedAmount` 高低水位）、进度、取消清理。核心重点覆盖。
- `storage`：每种 writer 测写接口；File System Access / StreamSaver 用 mock，验证"建目录→写块→关闭"调用序列。
- `peer-connection`：mock `RTCPeerConnection`，验证协商状态机与可插拔 ICE/TURN 配置注入。

### 6.4 端到端（Playwright，真浏览器双页）

- 两个浏览器上下文（发送/接收），连真实本地信令服务，走 `localhost` 真实 WebRTC（环回无需 TURN）。
- 用例：传单文件、传多文件、传文件夹（验证目录结构还原）、接收方拒绝、传输中取消。
- 校验收到文件字节与校验和与源一致。
- 用几十 MB 生成文件做大文件冒烟（验证分片 + 背压不崩）。

### 6.5 测试基调

- `protocol` 与 `transfer` 核心逻辑走 **TDD**。
- 浏览器 API 封装层薄、用 mock 验证调用契约。
- E2E 兜住"端到端真的能传成功"底线。
- CI：单元/集成快跑；E2E 跑核心几条。
