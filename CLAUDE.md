# CLAUDE.md

面向 Claude Code 的项目工程约定。完整背景见 `README.md` 与 `docs/superpowers/specs/2026-06-08-peerlink-web-design.md`。

## 项目概述

PeerLink：基于 WebRTC 的 P2P 即时通讯 + 文件传输系统（Web 版）。**并行多会话 IM**：一个 `SessionManager` 持有 N 条彼此隔离的一对一会话（左侧 Inbox 列表 + 右侧当前会话，非群聊），每条会话 = 独立房间 + ws + `RTCPeerConnection` + `DataChannel` + `Conversation` 编排器。单会话内于**统一时间线**互发文字、语音消息、文件、通话记录（文件保留 accept/reject 确认，纯会话内存阅后即焚）。还支持**实时语音通话**（电话式振铃，音频走 WebRTC 音频轨）与**1v1 会议屏幕共享**（通话之上发起，画面走 WebRTC 视频轨，一次一个演示者，切会议布局）。信令与传输彻底分离——文字 / 语音 / 文件数据全部 P2P 直传，**永不经过信令服务**（仅通话音频 + 屏幕共享视频协商的 SDP/ICE 走信令透传）。`packages/protocol` 是协议唯一事实源（zod schema + CRC32），前后端共享；多会话复杂度全部收敛在前端，**协议层与信令服务保持 1-1、`MAX_MEMBERS = 2` 不变**。

## Monorepo

pnpm@10 workspace（`apps/*` + `packages/*`），Node ≥22，全 ESM，Turborepo 编排。

- `packages/protocol`（`@peerlink/protocol`）— 信令消息 + 控制帧（`chat` 文字 / `manifest`·`accept`·`reject`·`file-complete`·`transfer-complete`·`cancel` 文件带 `transferId` / `voice-start`·`voice-complete` 语音 / `call-invite`·`call-accept`·`call-reject`·`call-end` 通话 + `screen-start`·`screen-stop` 屏幕共享，均带 `callId`）+ 分片帧 + CRC32，纯逻辑，被另两端依赖。
- `apps/signaling`（`@peerlink/signaling`）— 轻量 `ws` + zod + pino 信令服务，**全内存无数据库**。公网加固：`maxPayload` 上限 + 可选 Origin 白名单（`ALLOWED_ORIGINS`）+ ping/pong 心跳回收僵尸连接，均 env 可配（见 `.env.example`）。房间口令为 `数字-词-词`（如 `8423-河马-火山`）。
- `apps/web`（`@peerlink/web`）— React 19 + Vite + Tailwind v4 前端，内部分 `core/`（signaling-client / peer-connection / **conversation**（单会话编排器）/ **session-manager**（多会话管理）/ **call-session**（通话状态机）/ **screen-share**（屏幕共享状态机）/ **voice-stream**（语音消息状态机）/ **channel**（`SendChannel` 发送通道抽象，解耦 sender 与 `RTCDataChannel` 便于测试）/ sender / receiver / voice-recorder / mic / ringtone / storage）、`state/`、`features/`（Inbox 会话列表 + chat 时间线 + CallPanel 通话/会议 UI + CallChatRail 会议聊天侧栏 + share 口令二维码 + settings 桌面壳信令/ICE 配置）、`lib/`（含 `desktop-bridge.ts` 探测桌面壳注入的桥，浏览器中优雅降级）、`routes/`。`conversation.ts` 是单会话对称编排器：一条 DataChannel 上多路复用「文件传输 + 文字 + 语音消息 + 通话控制 + 屏幕共享控制」（按 `transferId`/`fileId`/`msgId`/`callId` 路由），但把通话 / 屏幕共享 / 语音三类媒体各自委派给独立的注入式状态机；`core/session-manager.ts` 是纯逻辑多会话管理器（持有 N 个 conversation handle），`state/session-manager.ts` 是把它桥接到 zustand store 的薄适配层；`call-session.ts` 是排他的单路通话状态机（振铃/通话中/自愈宽限/结束，固定 initiator 端发起 renegotiation 避免 glare）；`screen-share.ts` 是屏幕共享状态机（`none`/`local`/`remote`，依附通话 `callId`，一次一个演示者，同样固定 initiator 端 renegotiation，画面走 `peer-connection` 上可复用的视频 transceiver）；`voice-stream.ts` 是语音消息发送/接收组装（按 `streamId` 认领数据帧，接收侧带 TTL 防未收齐的消息内存驻留）。
- `apps/desktop`（`@peerlink/desktop`）— Electron 桌面壳，**复用 `@peerlink/web`（`workspace:*`）整套渲染层**，主进程（`src/main`）补足浏览器没有的能力：自定义 `app://` 协议托管打包后的 renderer、系统托盘 + 关闭即最小化到托盘、原生桌面通知（来消息/来电）、原生屏幕源选择器（Electron `getDisplayMedia` 需自带 picker，见 `src/picker`）、设置面板里可配信令域名 + ICE 并持久化（`config-store`）、单实例锁。`build.mjs`（esbuild）打 main/preload/picker，`electron-builder`（`electron-builder.yml`）出 mac dmg / win portable+nsis / linux AppImage+deb，由 `.github/workflows/desktop-release.yml` 打 `v*` tag 或手动 dispatch 触发。web 与桌面壳经 `preload` 注入的 `window.peerlink` 桥通信。

跨包引用用 `workspace:*`。改协议（`packages/protocol`）会同时影响两端，务必同步。桌面壳不复制业务逻辑——只包壳，UI 与传输全走 `@peerlink/web`。

## 命令

```bash
pnpm dev                                  # 全部 dev server（signaling :3001 + web :5173）
pnpm test / typecheck / lint / build      # 全量（turbo）
pnpm --filter @peerlink/<pkg> <script>    # 单包
pnpm --filter @peerlink/desktop dev       # 桌面壳：web dev + esbuild watch + electron
pnpm --filter @peerlink/desktop dist      # 本地打安装包（electron-builder）
```

提交前 Husky + lint-staged 自动 `prettier --write` + 对应包 `eslint --fix`。

## 工程约定（对齐姊妹项目 smart-property）

- 版本统一在根 `pnpm-workspace.yaml` 的 `catalog:` 声明，各包引用 `catalog:`，不写死版本号。
- ESLint flat config：根 `eslint.config.base.mjs`，`@typescript-eslint/no-explicit-any: error` + `simple-import-sort`。各包 extends 并加框架插件。
- Prettier：单引号 / semi / tabWidth 2 / trailingComma es5 / printWidth 80 / arrowParens avoid。
- 运行时数据校验统一 **zod**；信令服务日志用 **pino**。
- 单测 **Vitest**，`*.spec.ts` 与源码**同目录共置**。纯逻辑（protocol / transfer）走 TDD；浏览器 API 封装层用 mock 验证调用契约。
- `.npmrc` registry = npmmirror 国内镜像。
- 前端栈对齐：TanStack Router（文件式路由，`routeTree.gen.ts` 自动生成）+ zustand + sonner + lucide-react，className 合并用 `lib/cn.ts`。
- 全局 React 19 / Tailwind v4 约定见用户全局 CLAUDE.md（无 forwardRef、优先标准 utility class 等）。

## 容器内开发的坑（重要）

- **测试运行中的服务不能在宿主机 curl**：本机是 WSL，宿主 shell 访问映射端口（如 `localhost:8894`）连不上，返回 `000`。必须在容器内或同一 docker 网络测：`docker compose exec <service> ...` 或 `docker run --rm --network peerlink_internal ...`。浏览器手测由用户在真实浏览器做。
- **端口避让**：本机多套 Traefik 共占端口，PeerLink 用 **8894/8895**，内部网络 `peerlink_internal`。
- **Traefik 约束**：多项目共享 `/var/run/docker.sock`，PeerLink 的 Traefik 加了 `constraints=Label(com.docker.compose.project, peerlink)` 只认本项目容器，避免读到别的项目标签导致路由撞车。
- **容器内连不上 npm registry**：`docker/Dockerfile.dev` 构建期已烧进 `corepack prepare pnpm@10.33.2`（走 npmmirror），deps 用 `--frozen-lockfile --prefer-offline`（node_modules 已 bind-mount）。
- **Vite 经反代需 `allowedHosts`**：`apps/web/vite.config.ts` 在 `RUNNING_IN_DOCKER` 下设 `allowedHosts: true`，否则 Host 非 localhost 时 403。
- **Docker Hub 拉 `node:24-bookworm-slim` 在本机可能超时**（IPv6），属环境问题非代码缺陷。

## 部署 / CI

- `ci.yml`：lint / typecheck / test × Node 22/24 + 生产依赖审计。
- `docker-staging.yml`：push 到 `main` 即构建并推 `peerlink-web`/`peerlink-signaling` 的 **staging** 镜像到 `ghcr.io`。
- `docker-publish.yml`：打 `v*.*.*` tag 触发**正式**镜像构建发布。
- `desktop-release.yml`：打 `v*` tag 或手动 dispatch，三平台矩阵（ubuntu/windows/macos）`electron-builder` 出安装包，上传 artifact / 创建 Release。
- `push-tcr.yml`：手动 dispatch 把 ghcr 镜像同步到腾讯云 TCR（staging/latest/both）。

镜像 ICE 配置**运行时注入**——web 容器 entrypoint 按 `STUN_URLS`/`TURN_*` 环境变量生成 `ice-config.js`，改 env 重启即可，无需重建镜像。桌面壳的信令域名 + ICE 则由用户在应用内设置面板配置并本地持久化（默认 `wss://peerlink.qinjiapeng.com/signal`）。

> **公网上线坑**：信令 `ALLOWED_ORIGINS` 默认放行任意来源（不破坏局域网/开发）。公网部署若要拒绝跨站连接，**必须**在信令容器环境里显式填上前端域名，否则 Origin 防护是空的。

## 范围边界（YAGNI，阶段一非目标）

断点续传、群聊/群通话（>2 人同房间）、账号/昵称交换/历史持久化、自建 TURN、信令水平扩展、摄像头视频通话（屏幕共享已支持，但不含摄像头画面）、多人同时演示、屏幕共享标注/录制、通话录音/设备切换/网络质量指示、移动端原生 App / 小程序（桌面壳已交付，移动端仍为后续独立计划）——均不在当前范围。
