# PeerLink

基于 **WebRTC** 的点对点（P2P）即时通讯 + 文件传输系统。文字、语音、文件与实时通话音频在两台设备的浏览器间**直传，不经过服务器**——服务器只做撮合（交换 SDP/ICE、局域网分组），看不到任何内容。

- **多会话 IM（并行多房间）**：左侧常驻会话列表（Inbox），右侧当前会话详情，像微信/Telegram 那样同时维护多条彼此独立的一对一会话（**非群聊**）。一个联系人 = 一条独立的 P2P 房间，互不串扰。
- **统一时间线**：每条会话内，文字、语音消息、文件、通话记录同处一条时间线，以消息气泡呈现；纯会话内存，刷新即清空整个列表（阅后即焚）。
- **语音消息**：录完即发的异步音频，走 DataChannel 当文件分片传，CRC32 校验，微信式气泡点按播放。
- **实时语音通话**：电话式振铃，一方拨打、另一方接听后双向音频经 WebRTC 音频轨实时传输（含静音、计时、连接状态指示、挂断；结束后时间线留记录）。
- **文件确认握手**：对端发文件先出「接收 / 拒绝」气泡，确认后才开始 P2P 直传，气泡内显示进度。
- **同局域网自动发现**：连上即可看到同一出口网络下的在线设备，点选直接发起（类 Snapdrop）。
- **跨网络配对**：通过 链接 / 二维码 / 短口令（`4 位数字 + 中文词`，如 `8423-河马`）配对（类 ShareDrop）。
- **多文件 + 整个文件夹**：保留目录结构，支持 GB 级大文件流式落盘，不全攒内存。
- **掉线灰显 + 自愈重连**：对方掉线时会话灰显保留、历史可看，直到手动移除或刷新；通话中 ICE 短暂断连有宽限期自愈。
- **可插拔 ICE**：默认公共 STUN，TURN 可在部署侧按环境变量注入。

> 当前为**阶段一（Web 版）**。原生 App（阶段二）、微信小程序（阶段三）、自建 TURN（阶段 1.5）为后续独立计划，复用本阶段的信令服务与协议包。

---

## 架构

```
        ┌─────────────┐   WebSocket(信令)   ┌─────────────┐
        │  对端浏览器 A  │◄──────────────────►│             │
        │  (web app)   │                    │  信令服务    │
        └──────┬──────┘                     │ (signaling) │
               │            WebSocket(信令)   └──────▲──────┘
               │      ┌─────────────┐               │
               └─────►│  对端浏览器 B │◄──────────────┘
   WebRTC DataChannel │  (web app)   │
  (文字+文件 P2P 直传,  └─────────────┘
       不过服务器)
```

连接建立后两端**对称**：同一条 DataChannel 上互发文字、语音消息与文件，均 P2P 直传；实时通话音频则单开 WebRTC 音频轨。

**多会话 = 并行多房间**：一个 `SessionManager` 持有 N 条彼此隔离的会话，每条会话 = 一个房间 = 一条独立 ws + 一个 `RTCPeerConnection` + 一条 `DataChannel` + 一个 `Conversation` 编排器。因此信令服务与协议层无需感知多会话（DataChannel 仍严格 1-1，`MAX_MEMBERS = 2` 不变）——复杂度全部收敛在前端 state 层与 UI 层。

```
                       ┌─ Session A: ws──PeerConnection──DataChannel──Conversation ─→ peer A
   SessionManager ─────┼─ Session B: ws──PeerConnection──DataChannel──Conversation ─→ peer B
   (持有 N 个 handle)   └─ Session C: (等待加入，仅 ws + 房间，未接通)
```

**核心设计原则**：信令与传输彻底分离，文字 / 语音 / 文件数据永不经过信令服务（仅通话媒体协商的 SDP/ICE 走信令透传）；`packages/protocol` 是协议的唯一事实源（zod schema 定义所有信令消息、控制帧与分片帧，前后端共享同一套类型与运行时校验）。

### Monorepo 结构（pnpm workspace + Turborepo）

```
peerlink/
├── apps/
│   ├── web/                  # @peerlink/web — React 19 + Vite + Tailwind v4 前端
│   └── signaling/            # @peerlink/signaling — 轻量 ws + zod + pino 信令服务
├── packages/
│   └── protocol/             # @peerlink/protocol — zod 信令消息 + 文件分片协议 + CRC32
├── docker/                   # 开发镜像 + 生产镜像（web/signaling）+ ICE 运行时注入
├── docker-compose.yml        # 容器内开发：deps + traefik + web + signaling
├── docker-compose.override.yml  # 仅把 Traefik 端口暴露到宿主
├── .github/workflows/        # CI（lint/typecheck/test）+ 生产镜像构建发布
└── pnpm-workspace.yaml       # 含 catalog: 集中版本声明
```

`apps/web` 与 `apps/signaling` 均依赖 `@peerlink/protocol`（`workspace:*`）——协议层是两端唯一事实源。

### 前端内部分层（`apps/web/src`）

| 层                 | 位置                                                          | 职责                                                                                                                                     |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `signaling-client` | `core/signaling-client.ts`                                    | WebSocket 连接与信令收发（zod 校验）                                                                                                     |
| `peer-connection`  | `core/peer-connection.ts`                                     | 封装 `RTCPeerConnection`、ICE、DataChannel 建立；通话音频轨 `addTrack` + renegotiation + mute（对称收发）                                |
| `conversation`     | `core/conversation.ts`                                        | 单会话对称编排器：一条 DataChannel 多路复用「多次文件传输 + 文字 + 语音消息 + 通话控制」，按 `transferId`/`fileId`/`msgId`/`callId` 路由 |
| `session-manager`  | `core/session-manager.ts`                                     | 多会话管理器：持有 N 个 `Conversation` handle，桥接到 store，统一处理来电/振铃                                                           |
| `call-session`     | `core/call-session.ts`                                        | 单路通话状态机（振铃 / 通话中 / 自愈宽限 / 结束），排他，固定 initiator 端发起 renegotiation 避免 glare                                  |
| `transfer`         | `core/sender.ts` / `core/receiver.ts`                         | 单次文件分片、背压控制、组装、CRC32 校验（每个 transfer 一实例）                                                                         |
| `voice`            | `core/voice-recorder.ts` / `core/mic.ts` / `core/ringtone.ts` | 语音消息录制（`MediaRecorder`）、麦克风采集（能力/权限探测）、WebAudio 振铃音                                                            |
| `storage`          | `core/storage/*`                                              | 接收端写入抽象（File System Access / 内存 Blob，按能力探测；不兼容场景门控拒收）                                                         |
| `state`            | `state/conversation-store.ts`                                 | zustand 多会话列表 + 每会话统一时间线 `items[]` + 通话状态                                                                               |
| `ui`               | `features/chat/*` / `routes/*`                                | Inbox（会话列表）/ ConversationView / Timeline / 气泡 / Composer / CallPanel / IncomingCallPrompt + TanStack 文件式路由                  |

后续 App 可替换 `storage` / `ui`，复用 `protocol` / `conversation` / `session-manager` / `call-session` / `transfer` / `peer-connection` / `signaling-client`。

---

## 本地开发

### 方式一：原生 dev（最简单）

```bash
pnpm install
pnpm dev          # 同时起 signaling(:3001) + web(:5173)，vite 把 /signal 代理到信令服务
```

浏览器打开 http://localhost:5173 自动建房并显示口令/二维码，对端扫码或打开 `/r/<code>` 链接加入，连接后即进入对话——双向互发文字 / 语音 / 文件，并可发起实时语音通话。

也可分别起：

```bash
pnpm --filter @peerlink/signaling dev   # 信令服务，:3001
pnpm --filter @peerlink/web dev         # 前端，:5173
```

### 方式二：容器内开发（对齐部署环境）

所有 app 跑在容器内，Traefik 统一反代，宿主只暴露 Traefik 端口。

```bash
cp .env.example .env      # 按需调整端口 / ICE 配置；Linux 下建议 UID/GID 设为 id -u / id -g
docker compose up
```

- `http://localhost:8894/` → web（Vite dev server）
- `http://localhost:8894/signal` → signaling（WebSocket）
- `http://localhost:8895/` → Traefik dashboard

改 `apps/web/vite.config.ts` 等配置后 `docker compose restart web`。

> **端口约定**：本机已有多套 Traefik（smart-property=8888/8889、stock-trading=8890/8891、agent-x=8892/8893），PeerLink 用 **8894/8895**，内部网络 `peerlink_internal`。

### 常用命令

| 命令                                     | 说明                         |
| ---------------------------------------- | ---------------------------- |
| `pnpm dev`                               | 启动所有 dev server（turbo） |
| `pnpm build`                             | 构建所有包                   |
| `pnpm test`                              | 跑全部 Vitest 单元测试       |
| `pnpm typecheck`                         | 全量类型检查                 |
| `pnpm lint`                              | ESLint                       |
| `pnpm format`                            | Prettier 写入                |
| `pnpm --filter @peerlink/<pkg> <script>` | 针对单个包执行               |

---

## 协议速览

### 信令消息（`packages/protocol/src/signaling.ts`）

带 `type` 字段的 JSON，由 zod discriminated union 定义。`signal` 是核心透传通道——服务不解析 SDP/ICE 内容，仅按 `roomId` / `peerId` 转发给对端。

| 方向  | type                                         | 用途                                                                             |
| ----- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| C→S   | `create-room` / `join-room`                  | 创建 / 加入房间                                                                  |
| S→C   | `room-created` / `peer-joined` / `peer-left` | 房间码与对端进出通知                                                             |
| S→C   | `lan-peers`                                  | 局域网在线设备列表                                                               |
| C→S   | `lan-invite`                                 | 邀请某局域网设备                                                                 |
| C↔S↔C | `signal`                                     | 转发 SDP / ICE candidate                                                         |
| S→C   | `error`                                      | `ROOM_NOT_FOUND` / `ROOM_FULL` / `ROOM_EXPIRED` / `BAD_MESSAGE` / `RATE_LIMITED` |

信令服务全内存：`Map<roomId, Room>` + 按出口 IP 分组的局域网注册表，**无数据库**。房间默认 10 分钟无人加入自动回收。

### DataChannel 传输（`packages/protocol/src/control.ts` + `apps/web/src/core`）

一条 DataChannel 多路复用文件传输、文字、语音消息与通话控制，所有控制帧由 zod discriminated union（`controlMessageSchema`）定义：

| 分组     | 控制帧（JSON）                                                                      | 路由键                                      |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| 文字     | `chat`                                                                              | `msgId`                                     |
| 文件     | `manifest` / `accept` / `reject` / `file-complete` / `transfer-complete` / `cancel` | `transferId`（`file-complete` 按 `fileId`） |
| 语音消息 | `voice-start` / `voice-complete`                                                    | `msgId` / `streamId`                        |
| 通话控制 | `call-invite` / `call-accept` / `call-reject` / `call-end`（带 reason 枚举）        | `callId`                                    |

- **数据帧（二进制）**：`[1 字节类型][定长头: fileId + chunkIndex][数据负载]`。`fileId`（语音消息复用同一帧的 `streamId`）为发送方会话内单调递增，接收端据此把数据帧路由到对应 transfer / 语音流。
- **块大小**：默认 48 KB（整帧 < 64 KB，跨浏览器安全）；探测到更大 `maxMessageSize` 可升到 64 KB。
- **背压**：`bufferedAmount` 超 1 MB 高水位暂停，降到 256 KB 低水位恢复；`File.slice()` 流式读取。
- **完整性**：每文件 / 每条语音传完发 `file-complete` / `voice-complete` 带 CRC32 校验和，接收端比对。

接收端写入按浏览器能力选择：File System Access（Chromium，选目录边收边写，单文件/多文件/文件夹通吃）→ 内存 Blob（其余浏览器的单文件兜底，直接触发下载）。不支持 File System Access 的浏览器收到多文件/文件夹时直接门控拒收并提示换 Chromium 内核。

### 实时语音通话（WebRTC 音频轨）

通话控制（invite/accept/reject/end）走**已连接的 DataChannel**（复用上表帧机制，零额外信令成本）；接听后双方 `addTrack(麦克风)` 触发 **renegotiation**，新一轮 offer/answer 经信令服务 `signal` 透传，ICE 复用——协议层 `signaling.ts` 不变。由固定的「原始 PC initiator」一端发起 offer，规避双方同时 `createOffer` 的 glare 冲突。任意时刻只允许一路通话（排他）。相关常量见 `constants.ts`：振铃无应答超时 `CALL_RING_TIMEOUT_MS`（30s）、断连自愈宽限 `CALL_GRACE_MS`（8s）、单条语音最长 `MAX_VOICE_DURATION_MS`（60s）。

---

## 部署

生产镜像由 `.github/workflows/docker-publish.yml` 在打 `v*.*.*` tag 时构建并推送到 `ghcr.io`：

- `ghcr.io/<owner>/peerlink-web`（nginx 托管静态产物，并把 `/signal` 反代到信令服务）
- `ghcr.io/<owner>/peerlink-signaling`

**ICE 配置走运行时注入**：web 容器启动时由 `docker/40-peerlink-ice-config.sh` 按环境变量（`STUN_URLS` / `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL`）生成 `ice-config.js`——改环境变量后重启容器即生效，**无需重建镜像**。

---

## 技术栈

- **前端**：React 19 · Vite · Tailwind CSS v4 · TanStack Router · zustand · sonner · lucide-react · qrcode
- **信令**：Node ≥22 · `ws` · zod · pino（轻量，无 NestJS）
- **协议**：zod schema + CRC32
- **工程**：pnpm@10 workspace（`catalog:` 集中版本）· Turborepo · ESLint flat config · Prettier · Husky + lint-staged · Vitest · 国内镜像源（npmmirror）
