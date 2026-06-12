# CLAUDE.md

面向 Claude Code 的项目工程约定。完整背景见 `README.md` 与 `docs/superpowers/specs/2026-06-08-peerlink-web-design.md`。

## 项目概述

PeerLink：基于 WebRTC 的 P2P 即时通讯 + 文件传输系统（Web 版）。**并行多会话 IM**：一个 `SessionManager` 持有 N 条彼此隔离的一对一会话（左侧 Inbox 列表 + 右侧当前会话，非群聊），每条会话 = 独立房间 + ws + `RTCPeerConnection` + `DataChannel` + `Conversation` 编排器。单会话内于**统一时间线**互发文字、语音消息、文件、通话记录（文件保留 accept/reject 确认，纯会话内存阅后即焚）。还支持**实时语音通话**（电话式振铃，音频走 WebRTC 音频轨）。信令与传输彻底分离——文字 / 语音 / 文件数据全部 P2P 直传，**永不经过信令服务**（仅通话媒体协商的 SDP/ICE 走信令透传）。`packages/protocol` 是协议唯一事实源（zod schema + CRC32），前后端共享；多会话复杂度全部收敛在前端，**协议层与信令服务保持 1-1、`MAX_MEMBERS = 2` 不变**。

## Monorepo

pnpm@10 workspace（`apps/*` + `packages/*`），Node ≥22，全 ESM，Turborepo 编排。

- `packages/protocol`（`@peerlink/protocol`）— 信令消息 + 控制帧（`chat` 文字 / `manifest`·`accept`·`reject`·`file-complete`·`transfer-complete`·`cancel` 文件带 `transferId` / `voice-start`·`voice-complete` 语音 / `call-invite`·`call-accept`·`call-reject`·`call-end` 通话带 `callId`）+ 分片帧 + CRC32，纯逻辑，被另两端依赖。
- `apps/signaling`（`@peerlink/signaling`）— 轻量 `ws` + zod + pino 信令服务，**全内存无数据库**。
- `apps/web`（`@peerlink/web`）— React 19 + Vite + Tailwind v4 前端，内部分 `core/`（signaling-client / peer-connection / **conversation**（单会话编排器）/ **session-manager**（多会话管理）/ **call-session**（通话状态机）/ sender / receiver / voice-recorder / mic / ringtone / storage）、`state/`、`features/`（Inbox 会话列表 + chat 时间线 + CallPanel 通话 UI）、`routes/`。`conversation.ts` 是单会话对称编排器：一条 DataChannel 上多路复用「文件传输 + 文字 + 语音消息 + 通话控制」（按 `transferId`/`fileId`/`msgId`/`callId` 路由）；`session-manager.ts` 持有 N 个 conversation handle 并桥接到 store；`call-session.ts` 是排他的单路通话状态机（振铃/通话中/自愈宽限/结束，固定 initiator 端发起 renegotiation 避免 glare）。

跨包引用用 `workspace:*`。改协议（`packages/protocol`）会同时影响两端，务必同步。

## 命令

```bash
pnpm dev                                  # 全部 dev server（signaling :3001 + web :5173）
pnpm test / typecheck / lint / build      # 全量（turbo）
pnpm --filter @peerlink/<pkg> <script>    # 单包
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

## 部署

生产镜像（`ghcr.io/<owner>/peerlink-web` + `peerlink-signaling`）由打 `v*.*.*` tag 触发构建。ICE 配置**运行时注入**——web 容器 entrypoint 按 `STUN_URLS`/`TURN_*` 环境变量生成 `ice-config.js`，改 env 重启即可，无需重建镜像。

## 范围边界（YAGNI，阶段一非目标）

断点续传、群聊/群通话（>2 人同房间）、账号/昵称交换/历史持久化、自建 TURN、信令水平扩展、视频通话、通话录音/设备切换/网络质量指示——均不在当前范围。
