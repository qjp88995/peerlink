# PeerLink 桌面版设计（Phase 1）

- 日期：2026-06-13
- 状态：已通过 brainstorming，待实现计划
- 范围：把现有 PeerLink Web 版（`apps/web`）封装为三平台桌面客户端

## 背景与目标

PeerLink 是基于 WebRTC 的 P2P 即时通讯 + 文件传输 + 1v1 语音通话 + 会议屏幕共享系统，Web 版已上线于 `https://peerlink.qinjiapeng.com`。本设计把它做成桌面客户端，覆盖 **Windows / macOS / Linux** 三平台。

核心诉求（用户确认全要，分两阶段）：

- 常驻 + 原生体验（托盘、后台常驻、原生通知 + 声音）
- 突破浏览器限制（桌面端屏幕共享源选择）
- 可分发的安装包
- 信令服务器地址可在客户端配置

## 选型结论：Electron

三平台全覆盖 + 屏幕共享是核心功能 → 选 **Electron**（自带 Chromium）。

理由：PeerLink 重度依赖 WebRTC，尤其 `getDisplayMedia` 屏幕共享。Tauri 走系统 WebView，在 **Linux（WebKitGTK）和部分 macOS（WKWebView）上屏幕共享支持残缺甚至不可用**，会让会议模式瘫掉。Electron 自带 Chromium，三平台行为一致、屏幕共享稳定。代价是包体大（每平台 ~100MB+）、内存占用高，对 IM/会议工具可接受，也是行业惯例（Slack / Discord / VS Code）。

Electron 特有关键点：`getDisplayMedia` 需要主进程注册 `setDisplayMediaRequestHandler`（配合 `desktopCapturer`）才能拿到屏幕源，现有前端代码无需改动。

## 第一原则：不 fork 前端

线上 `peerlink.qinjiapeng.com` 继续使用同一份 `apps/web`。桌面版**复用其构建产物**，所有桌面专属能力收敛到一层薄 bridge 之后，Web 端用特性检测（`window.peerlink` 是否存在）自适应——浏览器里无 bridge 则走原逻辑。`apps/web` 核心代码仅在两处接入点改动（信令地址解析、通知触发）。

## 架构

### 新增包 `apps/desktop`（`@peerlink/desktop`）

```
apps/desktop/
  src/main/        # 主进程：窗口、托盘、屏幕源 handler、通知、配置存储、单实例锁
  src/preload/     # contextBridge 暴露 window.peerlink（设置读写、通知、窗口/托盘控制）
  src/picker/      # 自带屏幕源选择器窗口（列缩略图）
  electron-builder.yml
  package.json     # 依赖 @peerlink/web (workspace:*) 的 dist
```

renderer = 现有 `apps/web` 的构建产物。

### 加载策略（dev / prod 分离）

- **dev**：主进程加载 `http://localhost:5173`（Vite dev server），保留 HMR。
- **prod**：注册私有 `app://` 协议，从打包进去的 `apps/web/dist` 提供静态资源——**不用 `file://`**。原因：前端用 TanStack Router 客户端路由 + 代码分割，`file://` 下相对资源路径与路由刷新会出问题，`app://` 自定义协议能干净解决。

### Bridge 设计

preload 通过 `contextBridge` 暴露 `window.peerlink`：设置读写、原生通知、窗口/托盘控制、信令地址等。Web 端通过 `window.peerlink` 是否存在判断运行环境。

### 安全基线

`contextIsolation: true` + `nodeIntegration: false`。renderer 拿不到 Node API，只能经 bridge 白名单调用主进程。Electron 标准安全姿势。

## 运行时配置（信令地址 + ICE）

### 配置存储

主进程用 JSON 配置文件存设置，放在 `app.getPath('userData')` 下（如 `config.json`）。倾向用 `electron-store` 省去读写/默认值/迁移样板。内容：

```jsonc
{
  "signalUrl": "wss://peerlink.qinjiapeng.com/signal", // 由用户填的域名规范化而来
  "ice": {
    "stunUrls": "...",
    "turnUrl": "...",
    "turnUsername": "...",
    "turnCredential": "...",
  },
}
```

### 注入方式

preload 在页面脚本执行前同步读出配置挂到 window，复用前端已有注入约定：

- **ICE** → 填 `window.__PEERLINK_ICE__`，前端 `iceServersFromEnv()` 已优先读它，**零改动**。
- **信令地址** → 新增 `window.peerlink.signalUrl`。前端 `signalUrl()` 加最高优先级回退：

```ts
function signalUrl(): string {
  if (window.peerlink?.signalUrl) return window.peerlink.signalUrl; // 桌面端
  if (import.meta.env.VITE_SIGNAL_URL) return import.meta.env.VITE_SIGNAL_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${import.meta.env.VITE_SIGNAL_PATH ?? '/signal'}`;
}
```

### 域名规范化（用户决策）

用户在设置里**只填域名**（如 `peerlink.qinjiapeng.com`），软件自动补 `wss://` + `/signal` 路径。规范化放主进程：`https→wss`、`http→ws`、补 `/signal`，存进去即为干净 ws URL，前端拿到即用。规范化是纯函数，单测覆盖。设置面板配小灰字说明默认值。

### 设置入口

Web 端新增轻量设置面板（改信令域名 + ICE/TURN），**仅在桌面端显示**（检测到 `window.peerlink` 才渲染入口），浏览器版不受影响。改完即时生效——重连信令时用新地址，无需重启应用。

## Phase 1 原生能力

### ① 屏幕共享源选择器

主进程注册 `session.setDisplayMediaRequestHandler`，拦截前端会议模式的 `getDisplayMedia`（前端调用**完全不动**）。

- 用 `desktopCapturer.getSources({ types: ['screen', 'window'] })` 拿全部屏幕/窗口。
- 弹**自带选择器窗口**（`apps/desktop/src/picker`，列缩略图供选），选完回填 source 给 handler。选择器属桌面壳，不污染 Web 前端。
- macOS 优先用系统原生选择器（`useSystemPicker: true`）；Win/Linux 用自带选择器。

### ② 托盘 + 后台常驻

- 托盘图标 + 菜单（打开主窗口 / 退出）。
- 关闭按钮 → 拦截 `close` 事件、`preventDefault` 后 `hide()` 到托盘，**不销毁窗口**——renderer 继续跑，WebRTC 连接 / 会话 / 信令全部存活。真正退出走托盘菜单或 macOS `Cmd+Q`（需退出标志位）。
- 单实例锁（`requestSingleInstanceLock`）：再次启动只把已有窗口拉到前台。

### ③ 原生通知 + 声音

职责划分：**renderer 负责"发生了什么"，主进程负责"要不要打扰 + 怎么打扰"**。

- 前端已有领域事件（来消息 / 来电）和"当前焦点会话"信息，经 `window.peerlink.notify({ title, body, kind, sessionId })` 上报。
- 主进程裁决是否弹：窗口正焦点且停在该会话时不打扰；否则弹原生系统通知，点通知 → 唤起窗口并跳到对应会话。
- **声音**：来电振铃 `ringtone.ts` 已有，窗口隐藏时 renderer 仍跑、声音照响，基本零改动；来消息提示音新增一小段。
- 点缀：Windows `flashFrame` 闪任务栏、macOS Dock 角标/弹跳。

## 构建、分发与测试

### 打包：electron-builder

| 平台    | 格式                 | 备注                                             |
| ------- | -------------------- | ------------------------------------------------ |
| Windows | NSIS `.exe`          | 默认每用户安装，免管理员权限                     |
| macOS   | `.dmg`               | universal（Intel + Apple Silicon）               |
| Linux   | `.AppImage` + `.deb` | AppImage 免安装双击即跑；deb 供 Debian/Ubuntu 系 |

### 构建流水线

`apps/web` 先 `vite build`（**为 `app://` 把 Vite `base` 设为相对 `./`**，否则资源 404），electron-builder 把 `dist` + 主进程/preload 产物打进安装包。Turborepo 加 `desktop` build task，依赖 `@peerlink/web#build`。

### CI / 发布

复用现有"打 `v*.*.*` tag 触发构建"约定，新增 GitHub Actions matrix（windows / macos / ubuntu）跑 electron-builder，产物传 Release。

### 测试策略（对齐项目约定）

- **纯逻辑单测（TDD，`*.spec.ts` 共置）**：域名→`wss://…/signal` 规范化、配置读写默认值/迁移——抽成纯函数。
- **契约 mock 测**：preload bridge 暴露面、`setDisplayMediaRequestHandler` 回填逻辑——mock Electron API 验调用契约。
- **手动冒烟**：托盘 / 通知 / 屏幕共享 / 跨平台行为，由用户真机点。计划里列冒烟清单，不自动化。

## 范围边界

### Phase 2（明确不在本次范围）

- 开机自启
- 文件直接落盘到指定目录（绕过浏览器下载）
- 代码签名（Phase 1 产物未签名：Windows 弹 SmartScreen、macOS 需右键打开绕过 Gatekeeper）
- 自动更新（electron-updater，需配合签名）

### 协议层不变

桌面化纯属前端封装。`packages/protocol` 与 `apps/signaling` 维持 1-1、`MAX_MEMBERS = 2` 不变。
