# PeerLink

基于 **WebRTC** 的点对点（P2P）即时通讯 + 文件传输系统。文字消息与文件在两台设备的浏览器间**直传，不经过服务器**——服务器只做撮合（交换 SDP/ICE、局域网分组），看不到任何内容。

- **统一时间线 IM**：两端进入同一房间即对称对话，文字消息与文件同处一条时间线，以消息气泡呈现；纯会话内存，刷新/断开即清空（阅后即焚）。
- **文件确认握手**：对端发文件先出「接收 / 拒绝」气泡，确认后才开始 P2P 直传，气泡内显示进度。
- **同局域网自动发现**：连上即可看到同一出口网络下的在线设备，点选直接发起（类 Snapdrop）。
- **跨网络配对**：通过 链接 / 二维码 / 短口令（`4 位数字 + 中文词`，如 `8423-河马`）配对（类 ShareDrop）。
- **多文件 + 整个文件夹**：保留目录结构，支持 GB 级大文件流式落盘，不全攒内存。
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

连接建立后两端**对称**：同一条 DataChannel 上互发文字消息与文件，均 P2P 直传。

**核心设计原则**：信令与传输彻底分离，文字与文件数据永不经过信令服务；`packages/protocol` 是协议的唯一事实源（zod schema 定义所有信令消息、控制帧与分片帧，前后端共享同一套类型与运行时校验）。

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

| 层                 | 位置                                  | 职责                                                                                            |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `signaling-client` | `core/signaling-client.ts`            | WebSocket 连接与信令收发（zod 校验）                                                            |
| `peer-connection`  | `core/peer-connection.ts`             | 封装 `RTCPeerConnection`、ICE、DataChannel 建立（对称，两端可收发）                             |
| `conversation`     | `core/conversation.ts`                | 对称编排器：一条 DataChannel 多路复用「多次文件传输 + 文字消息」，按 `transferId`/`fileId` 路由 |
| `transfer`         | `core/sender.ts` / `core/receiver.ts` | 单次文件分片、背压控制、组装、CRC32 校验（每个 transfer 一实例）                                |
| `storage`          | `core/storage/*`                      | 接收端写入抽象（File System Access / 内存 Blob，按能力探测；不兼容场景门控拒收）                |
| `state`            | `state/conversation-store.ts`         | zustand 连接状态 + 统一时间线 `items[]`                                                         |
| `ui`               | `features/chat/*` / `routes/*`        | ChatRoom / Timeline / 气泡 / Composer + TanStack 文件式路由                                     |

后续 App 可替换 `storage` / `ui`，复用 `protocol` / `conversation` / `transfer` / `peer-connection` / `signaling-client`。

---

## 本地开发

### 方式一：原生 dev（最简单）

```bash
pnpm install
pnpm dev          # 同时起 signaling(:3001) + web(:5173)，vite 把 /signal 代理到信令服务
```

浏览器打开 http://localhost:5173 自动建房并显示口令/二维码，对端扫码或打开 `/r/<code>` 链接加入，连接后即进入对话——双向互发文字与文件。

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

### 文件传输（DataChannel，`packages/protocol` + `apps/web/src/core`）

- **控制帧（JSON）**：`chat`（文字消息）/ `manifest` / `accept` / `reject` / `file-complete` / `transfer-complete` / `cancel`。文件类消息（除 `file-complete` 按 `fileId` 定位外）均带 `transferId`，使一条 DataChannel 上多次文件传输 + 文字消息可多路复用、互不串台。
- **数据帧（二进制）**：`[1 字节类型][定长头: fileId + chunkIndex][数据负载]`。`fileId` 为发送方会话内单调递增，接收端据此把数据帧路由到对应 transfer。
- **块大小**：默认 48 KB（整帧 < 64 KB，跨浏览器安全）；探测到更大 `maxMessageSize` 可升到 64 KB。
- **背压**：`bufferedAmount` 超 1 MB 高水位暂停，降到 256 KB 低水位恢复；`File.slice()` 流式读取。
- **完整性**：每文件传完发 `file-complete` 带 CRC32 校验和，接收端比对。

接收端写入按浏览器能力选择：File System Access（Chromium，选目录边收边写，单文件/多文件/文件夹通吃）→ 内存 Blob（其余浏览器的单文件兜底，直接触发下载）。不支持 File System Access 的浏览器收到多文件/文件夹时直接门控拒收并提示换 Chromium 内核。

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
