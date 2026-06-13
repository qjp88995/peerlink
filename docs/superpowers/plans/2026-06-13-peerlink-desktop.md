# PeerLink 桌面版（Electron）Phase 1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 `apps/web`（React + WebRTC）封装成 Windows/macOS/Linux 三平台 Electron 桌面客户端，支持可配置信令地址、桌面屏幕共享源选择、托盘后台常驻、原生通知 + 声音。

**Architecture:** 新增 `apps/desktop`（`@peerlink/desktop`）Electron 包，renderer 复用 `apps/web` 构建产物，**不 fork 前端**。所有桌面专属能力收敛到 preload 经 `contextBridge` 暴露的单一 `window.peerlink` 后；前端用特性检测自适应，浏览器里无 bridge 则走原逻辑。dev 加载 Vite dev server，prod 用自定义 `app://` 协议从打包进 asar 的 `dist/renderer` 提供静态资源。

**Tech Stack:** Electron + esbuild（打包 main/preload/picker，复用项目已有 esbuild）+ electron-builder（三平台分发）+ Vitest（纯逻辑 TDD）。配置用自写 JSON store（对齐项目"无数据库"作风，零新增运行时依赖）。

**关键设计决策（实现时务必遵守）：**

1. **ICE 与信令地址都走 `window.peerlink`**，不走 `window.__PEERLINK_ICE__`。原因：前端 `index.html` 里 `<script src="/ice-config.js">` 会在 preload 之后执行并把 `window.__PEERLINK_ICE__` 重置为 `{}`，会覆盖 preload 注入。改为前端优先读 `window.peerlink?.ice` 即可绕开覆盖，且统一到单一 bridge。
2. **不修改 Vite `base`**。`app://` 自定义协议配 path 解析 handler，绝对路径 `/assets/...` 能正确解析到 `dist/assets/...`，无需 `base: './'`。web 部署（`peerlink.qinjiapeng.com`）继续 base `/` 不变。
3. **main / preload 打成 CommonJS（`.cjs`）**，`external: ['electron']`，`sandbox: false`（让 preload 能用 `ipcRenderer`），`contextIsolation: true` + `nodeIntegration: false`。
4. **bridge 契约类型**由 `apps/web` 拥有（消费方视角），preload 实现同一形状（结构化类型，跨包不强耦合构建）。两侧接口若改需同步。

---

## 文件结构

**新建（`apps/desktop`）：**

- `apps/desktop/package.json` — 包定义，`main` 指向 `dist/main.cjs`
- `apps/desktop/tsconfig.json` — extends 根 base
- `apps/desktop/eslint.config.mjs` — extends 根 base
- `apps/desktop/build.mjs` — esbuild 打包 main/preload/picker + 拷贝 web dist
- `apps/desktop/electron-builder.yml` — 三平台分发配置
- `apps/desktop/src/main/index.ts` — 主进程入口：窗口、协议、托盘、屏幕 handler、通知、IPC
- `apps/desktop/src/main/signal-url.ts` — 域名 → `wss://…/signal` 规范化（纯函数）
- `apps/desktop/src/main/signal-url.spec.ts`
- `apps/desktop/src/main/config-store.ts` — JSON 配置读写 + 默认值（可注入路径）
- `apps/desktop/src/main/config-store.spec.ts`
- `apps/desktop/src/main/app-protocol.ts` — `app://` 路径解析（纯函数 + 注册）
- `apps/desktop/src/main/app-protocol.spec.ts`
- `apps/desktop/src/main/screen-picker.ts` — 屏幕源 handler + 自带选择器窗口
- `apps/desktop/src/main/screen-picker.spec.ts`
- `apps/desktop/src/main/notifications.ts` — 原生通知展示 + 点击激活（薄封装）
- `apps/desktop/src/main/tray.ts` — 托盘 + 关窗到托盘 + 单实例
- `apps/desktop/src/preload/index.ts` — `contextBridge.exposeInMainWorld('peerlink', …)`
- `apps/desktop/src/picker/picker.html` + `picker.ts` — 选择器 UI（原生，无 React）
- `apps/desktop/resources/` — 托盘/应用图标占位
- `apps/desktop/.github-workflow-desktop.yml`（最终落到 `.github/workflows/`）

**修改（`apps/web`）：**

- `apps/web/src/lib/desktop-bridge.ts`（新建）— `PeerlinkBridge` 类型 + `getBridge()` + `Window.peerlink` 全局声明
- `apps/web/src/lib/ice-config.ts` — `iceServersFromEnv()` 优先读 `window.peerlink?.ice`
- `apps/web/src/lib/ice-config.spec.ts` — 增用例
- `apps/web/src/core/conversation.ts:487` — `signalUrl()` 优先读 `window.peerlink?.signalUrl`
- `apps/web/src/features/settings/SettingsPanel.tsx`（新建）— 桌面专属设置面板
- `apps/web/src/features/settings/desktop-notifications.ts`（新建）— store 订阅触发通知 + 提示音
- `apps/web/src/features/settings/desktop-notifications.spec.ts`
- 设置入口接入点（`Inbox` 顶部，Task 8 给出）

**根级修改：**

- `pnpm-workspace.yaml` — catalog 增 Electron 相关版本（由 `pnpm add` 落地）
- `turbo.json` — 无需改（`build` 已 `dependsOn ^build`）；desktop 的 `dist`/`build` task 走默认 outputs

---

## Task 0: 脚手架 `apps/desktop` 包

**Files:**

- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/eslint.config.mjs`
- Create: `apps/desktop/src/main/index.ts`（临时最小入口）

- [ ] **Step 1: 写包定义**

`apps/desktop/package.json`：

```jsonc
{
  "name": "@peerlink/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/main.cjs",
  "scripts": {
    "build": "node build.mjs",
    "dev": "node build.mjs --watch & wait-on dist/main.cjs && electron .",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "dist": "node build.mjs && electron-builder",
  },
  "dependencies": {
    "@peerlink/web": "workspace:*",
  },
  "devDependencies": {
    "@eslint/js": "catalog:",
    "@types/node": "catalog:",
    "esbuild": "catalog:",
    "eslint": "catalog:",
    "eslint-plugin-simple-import-sort": "catalog:",
    "globals": "catalog:",
    "typescript": "catalog:",
    "typescript-eslint": "catalog:",
    "vitest": "catalog:",
  },
}
```

（`electron` / `electron-builder` / `wait-on` 在 Step 4 用 `pnpm add` 落地真实版本。`dev` 脚本在 Task 9 会替换成 concurrently 版，这里先占位。）

- [ ] **Step 2: 写 tsconfig**

`apps/desktop/tsconfig.json`：

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "baseUrl": ".",
    "noEmit": true,
  },
  "include": ["src", "build.mjs"],
}
```

（`DOM` 用于 picker.ts；main 代码不用 DOM 类型但无害。）

- [ ] **Step 3: 写 eslint config**

`apps/desktop/eslint.config.mjs`（对齐 `apps/signaling/eslint.config.mjs` 的写法）：

```js
import js from '@eslint/js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'build'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  }
);
```

> 实现注意：先打开 `apps/signaling/eslint.config.mjs` 确认导入项与根 base 的实际写法，照抄结构，避免风格漂移。

- [ ] **Step 4: 安装 Electron 工具链并落到 catalog**

```bash
cd apps/desktop
pnpm add -D electron@latest electron-builder@latest wait-on@latest
```

然后把解析出的版本从 `apps/desktop/package.json` 抽到根 `pnpm-workspace.yaml` 的 `catalog:`（新增一组 `# ─── Desktop ───`），并把 `apps/desktop/package.json` 里这三个改成 `catalog:`。最后根目录 `pnpm install` 确认 lockfile 一致。

- [ ] **Step 5: 临时最小 main 入口**

`apps/desktop/src/main/index.ts`：

```ts
import { app, BrowserWindow } from 'electron';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1100, height: 760 });
  win.loadURL('data:text/html,<h1>PeerLink desktop scaffold</h1>');
});
```

- [ ] **Step 6: 验证 typecheck/lint 通过**

Run: `pnpm --filter @peerlink/desktop typecheck && pnpm --filter @peerlink/desktop lint`
Expected: 均无错误（无 build.mjs 时 lint 可能提示找不到，先忽略 build.mjs，Task 9 再补）。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(desktop): scaffold @peerlink/desktop electron package"
```

---

## Task 1: 信令域名规范化（纯函数，TDD）

**Files:**

- Create: `apps/desktop/src/main/signal-url.ts`
- Test: `apps/desktop/src/main/signal-url.spec.ts`

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/signal-url.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { domainFromSignalUrl, normalizeSignalDomain } from './signal-url';

describe('normalizeSignalDomain', () => {
  it('补全裸域名为 wss + /signal', () => {
    expect(normalizeSignalDomain('peerlink.qinjiapeng.com')).toBe(
      'wss://peerlink.qinjiapeng.com/signal'
    );
  });
  it('https → wss 并补 /signal', () => {
    expect(normalizeSignalDomain('https://example.com')).toBe(
      'wss://example.com/signal'
    );
  });
  it('http → ws', () => {
    expect(normalizeSignalDomain('http://localhost:3001')).toBe(
      'ws://localhost:3001/signal'
    );
  });
  it('已是 wss 且带 /signal 时保持幂等', () => {
    expect(normalizeSignalDomain('wss://example.com/signal')).toBe(
      'wss://example.com/signal'
    );
  });
  it('保留非默认路径', () => {
    expect(normalizeSignalDomain('example.com/custom')).toBe(
      'wss://example.com/custom'
    );
  });
  it('去除首尾空白', () => {
    expect(normalizeSignalDomain('  peerlink.qinjiapeng.com  ')).toBe(
      'wss://peerlink.qinjiapeng.com/signal'
    );
  });
  it('空串抛错', () => {
    expect(() => normalizeSignalDomain('')).toThrow();
  });
});

describe('domainFromSignalUrl', () => {
  it('反解出供展示的裸域名', () => {
    expect(domainFromSignalUrl('wss://peerlink.qinjiapeng.com/signal')).toBe(
      'peerlink.qinjiapeng.com'
    );
  });
  it('非默认路径时带上路径', () => {
    expect(domainFromSignalUrl('wss://example.com/custom')).toBe(
      'example.com/custom'
    );
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @peerlink/desktop test signal-url`
Expected: FAIL，找不到 `./signal-url`。

- [ ] **Step 3: 实现**

`apps/desktop/src/main/signal-url.ts`：

```ts
/** 把用户填的域名/URL 规范化为前端可直接用的 ws(s) 信令地址。 */
export function normalizeSignalDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('signal domain is empty');

  // 补协议，便于用 URL 解析；裸域名默认按安全协议处理。
  const withProto = /^[a-zA-Z]+:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProto);

  const wsProto =
    url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws' : 'wss';
  const path =
    url.pathname === '/' || url.pathname === '' ? '/signal' : url.pathname;
  return `${wsProto}://${url.host}${path}`;
}

/** 反解：从规范化后的 ws URL 取出供设置面板展示的域名（默认路径则隐藏）。 */
export function domainFromSignalUrl(signalUrl: string): string {
  const url = new URL(signalUrl);
  const path = url.pathname === '/signal' ? '' : url.pathname;
  return `${url.host}${path}`;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @peerlink/desktop test signal-url`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/signal-url.ts apps/desktop/src/main/signal-url.spec.ts
git commit -m "feat(desktop): signal domain normalization"
```

---

## Task 2: 配置存储（TDD，可注入路径）

**Files:**

- Create: `apps/desktop/src/main/config-store.ts`
- Test: `apps/desktop/src/main/config-store.spec.ts`

设计：纯 Node `fs` 读写 JSON。构造时注入文件路径（生产传 `app.getPath('userData')/config.json`，测试传临时目录），便于单测不依赖 Electron。`setSignalDomain` 内部调用 `normalizeSignalDomain`。

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/config-store.spec.ts`：

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigStore, DEFAULT_SIGNAL_URL } from './config-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peerlink-cfg-'));
  file = join(dir, 'config.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ConfigStore', () => {
  it('文件不存在时给出默认信令地址', () => {
    const store = new ConfigStore(file);
    expect(store.get().signalUrl).toBe(DEFAULT_SIGNAL_URL);
  });

  it('setSignalDomain 规范化后持久化', () => {
    const store = new ConfigStore(file);
    store.setSignalDomain('example.com');
    expect(store.get().signalUrl).toBe('wss://example.com/signal');

    // 重新读盘，确认已落地
    expect(new ConfigStore(file).get().signalUrl).toBe(
      'wss://example.com/signal'
    );
  });

  it('setIce 持久化 ICE 配置', () => {
    const store = new ConfigStore(file);
    store.setIce({ stunUrls: 'stun:a:3478', turnUrl: 'turn:b:3478' });
    expect(new ConfigStore(file).get().ice).toEqual({
      stunUrls: 'stun:a:3478',
      turnUrl: 'turn:b:3478',
    });
  });

  it('损坏的 JSON 回退到默认值而非崩溃', () => {
    const store = new ConfigStore(file);
    store.setSignalDomain('example.com');
    // 写入垃圾
    writeGarbage(file);
    expect(new ConfigStore(file).get().signalUrl).toBe(DEFAULT_SIGNAL_URL);
  });
});

function writeGarbage(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').writeFileSync(path, '{ not json');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @peerlink/desktop test config-store`
Expected: FAIL，找不到 `./config-store`。

- [ ] **Step 3: 实现**

`apps/desktop/src/main/config-store.ts`：

```ts
import { readFileSync, writeFileSync } from 'node:fs';

import { normalizeSignalDomain } from './signal-url';

export const DEFAULT_SIGNAL_URL = 'wss://peerlink.qinjiapeng.com/signal';

export interface IceConfig {
  stunUrls?: string;
  turnUrl?: string;
  turnUsername?: string;
  turnCredential?: string;
}

export interface PeerlinkConfig {
  signalUrl: string;
  ice: IceConfig;
}

const DEFAULTS: PeerlinkConfig = { signalUrl: DEFAULT_SIGNAL_URL, ice: {} };

export class ConfigStore {
  private config: PeerlinkConfig;

  constructor(private readonly file: string) {
    this.config = this.load();
  }

  get(): PeerlinkConfig {
    return this.config;
  }

  setSignalDomain(domain: string): void {
    this.config = { ...this.config, signalUrl: normalizeSignalDomain(domain) };
    this.persist();
  }

  setIce(ice: IceConfig): void {
    this.config = { ...this.config, ice };
    this.persist();
  }

  private load(): PeerlinkConfig {
    try {
      const raw = JSON.parse(
        readFileSync(this.file, 'utf8')
      ) as Partial<PeerlinkConfig>;
      return {
        signalUrl: raw.signalUrl ?? DEFAULTS.signalUrl,
        ice: raw.ice ?? {},
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.config, null, 2), 'utf8');
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @peerlink/desktop test config-store`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/config-store.ts apps/desktop/src/main/config-store.spec.ts
git commit -m "feat(desktop): JSON config store with defaults and corruption fallback"
```

---

## Task 3: `app://` 协议路径解析（TDD）+ 主窗口加载

**Files:**

- Create: `apps/desktop/src/main/app-protocol.ts`
- Test: `apps/desktop/src/main/app-protocol.spec.ts`
- Modify: `apps/desktop/src/main/index.ts`

设计拆分：把"URL → 磁盘文件路径"的解析逻辑抽成纯函数 `resolveRendererPath`（可测：防目录穿越、无扩展名/未找到时回退 `index.html` 以支持 SPA 刷新），协议注册和文件读取留给薄封装。

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/app-protocol.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { resolveRendererPath } from './app-protocol';

const ROOT = '/app/renderer';

describe('resolveRendererPath', () => {
  it('根路径返回 index.html', () => {
    expect(resolveRendererPath(ROOT, 'app://peerlink/')).toBe(
      '/app/renderer/index.html'
    );
  });
  it('带扩展名的资源原样解析', () => {
    expect(resolveRendererPath(ROOT, 'app://peerlink/assets/main-abc.js')).toBe(
      '/app/renderer/assets/main-abc.js'
    );
  });
  it('无扩展名的客户端路由回退 index.html（支持刷新/深链）', () => {
    expect(resolveRendererPath(ROOT, 'app://peerlink/room/xyz')).toBe(
      '/app/renderer/index.html'
    );
  });
  it('阻止目录穿越', () => {
    expect(resolveRendererPath(ROOT, 'app://peerlink/../../etc/passwd')).toBe(
      '/app/renderer/index.html'
    );
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @peerlink/desktop test app-protocol`
Expected: FAIL，找不到 `./app-protocol`。

- [ ] **Step 3: 实现纯函数 + 协议注册**

`apps/desktop/src/main/app-protocol.ts`：

```ts
import { readFile } from 'node:fs/promises';
import { normalize, sep } from 'node:path';

import { net, protocol } from 'electron';

export const APP_SCHEME = 'app';
const APP_ORIGIN = 'app://peerlink';

/** 把 app:// 请求 URL 映射到 renderer 根目录下的磁盘路径；越界或无扩展名回退 index.html。 */
export function resolveRendererPath(
  rendererRoot: string,
  requestUrl: string
): string {
  const { pathname } = new URL(requestUrl);
  const decoded = decodeURIComponent(pathname);
  const indexHtml = `${rendererRoot}${sep}index.html`;

  // 无扩展名 → 视为 SPA 客户端路由，回退 index.html
  const hasExt = /\.[a-z0-9]+$/i.test(decoded);
  if (decoded === '/' || decoded === '' || !hasExt) return indexHtml;

  const candidate = normalize(`${rendererRoot}${decoded}`);
  // 防目录穿越：必须仍在 root 下
  if (!candidate.startsWith(rendererRoot + sep)) return indexHtml;
  return candidate;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** 必须在 app.whenReady 之前调用，把 app:// 注册成标准+安全 scheme。 */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function registerAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async request => {
    const filePath = resolveRendererPath(rendererRoot, request.url);
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    try {
      const data = await readFile(filePath);
      return new Response(data, {
        headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

export { APP_ORIGIN };
```

> 实现注意：`net` 导入若未使用请删除（避免 lint 报未用）。`protocol.handle` 是 Electron ≥25 的 API；若安装到更老版本需改用 `protocol.registerBufferProtocol`，但当前装的是 latest，无虞。

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @peerlink/desktop test app-protocol`
Expected: PASS。

- [ ] **Step 5: 主窗口加载（dev/prod 分流）**

替换 `apps/desktop/src/main/index.ts`：

```ts
import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

import {
  APP_ORIGIN,
  registerAppProtocol,
  registerSchemePrivileges,
} from './app-protocol';
import { ConfigStore } from './config-store';

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

registerSchemePrivileges();

let mainWindow: BrowserWindow | undefined;
let config: ConfigStore;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/`);
  }
}

app.whenReady().then(() => {
  config = new ConfigStore(join(app.getPath('userData'), 'config.json'));
  if (!isDev) registerAppProtocol(join(__dirname, 'renderer'));
  createWindow();
});

app.on('window-all-closed', () => {
  // Task 6 会改成"关窗到托盘不退出"；当前先保留默认。
  if (process.platform !== 'darwin') app.quit();
});

export { config, mainWindow };
```

> `config` 暂时仅初始化，Task 4 起被 preload IPC 消费。`export` 是为后续 Task 引用同一实例（实际实现会改为模块内共享，避免循环依赖时可抽到单独 `state.ts`）。

- [ ] **Step 6: 验证 typecheck**

Run: `pnpm --filter @peerlink/desktop typecheck`
Expected: PASS（无 build.mjs 时仍可 typecheck）。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main
git commit -m "feat(desktop): app:// protocol resolution and main window load"
```

---

## Task 4: preload bridge + 前端 ICE/信令地址接入（TDD 前端改动）

**Files:**

- Create: `apps/web/src/lib/desktop-bridge.ts`
- Modify: `apps/web/src/lib/ice-config.ts`
- Modify: `apps/web/src/lib/ice-config.spec.ts`
- Modify: `apps/web/src/core/conversation.ts`（`signalUrl()`，约 487 行）
- Create: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: 定义 bridge 契约（前端拥有）**

`apps/web/src/lib/desktop-bridge.ts`：

```ts
import type { RuntimeIceConfig } from '@/lib/ice-config';

/** 桌面壳经 preload 注入的桥。浏览器中为 undefined。 */
export interface PeerlinkBridge {
  /** 规范化后的 ws(s) 信令地址 */
  readonly signalUrl: string;
  /** 运行时 ICE 配置 */
  readonly ice: RuntimeIceConfig;
  /** 当前展示用的信令域名（裸域名） */
  readonly signalDomain: string;
  /** 保存信令域名（保存后桌面端会重载窗口生效） */
  setSignalDomain(domain: string): Promise<void>;
  /** 保存 ICE 配置 */
  setIce(ice: RuntimeIceConfig): Promise<void>;
  /** 请求弹一条原生通知 */
  notify(payload: { title: string; body: string; sessionId: string }): void;
  /** 注册"用户点了通知/托盘要切到某会话"的回调 */
  onActivateSession(cb: (sessionId: string) => void): void;
}

declare global {
  interface Window {
    peerlink?: PeerlinkBridge;
  }
}

export function getBridge(): PeerlinkBridge | undefined {
  return typeof window !== 'undefined' ? window.peerlink : undefined;
}

export function isDesktop(): boolean {
  return !!getBridge();
}
```

- [ ] **Step 2: 写 ice-config 失败测试**

在 `apps/web/src/lib/ice-config.spec.ts` 增用例（保留现有用例）：

```ts
it('优先使用 window.peerlink.ice 而非 __PEERLINK_ICE__', () => {
  const original = window.peerlink;
  // @ts-expect-error 测试注入
  window.peerlink = { ice: { stunUrls: 'stun:bridge:3478' } };
  window.__PEERLINK_ICE__ = { stunUrls: 'stun:legacy:3478' };
  const servers = iceServersFromEnv();
  expect(servers.some(s => String(s.urls).includes('bridge'))).toBe(true);
  expect(servers.some(s => String(s.urls).includes('legacy'))).toBe(false);
  window.peerlink = original;
});
```

> 确认 `ice-config.spec.ts` 顶部已 `import { iceServersFromEnv } from './ice-config'`；若无则补。

- [ ] **Step 3: 运行验证失败**

Run: `pnpm --filter @peerlink/web test ice-config`
Expected: FAIL（当前未读 `window.peerlink.ice`）。

- [ ] **Step 4: 改 `iceServersFromEnv` 优先读 bridge**

`apps/web/src/lib/ice-config.ts` 的 `iceServersFromEnv()` 开头加最高优先级分支：

```ts
export function iceServersFromEnv(): RTCIceServer[] {
  // 桌面端：preload 注入的 ICE 优先（绕开 ice-config.js 的 {} 覆盖）
  const bridge = typeof window !== 'undefined' ? window.peerlink : undefined;
  if (
    bridge?.ice &&
    (bridge.ice.stunUrls?.trim() || bridge.ice.turnUrl?.trim())
  ) {
    return buildIceServers({
      VITE_STUN_URLS: bridge.ice.stunUrls,
      VITE_TURN_URL: bridge.ice.turnUrl,
      VITE_TURN_USERNAME: bridge.ice.turnUsername,
      VITE_TURN_CREDENTIAL: bridge.ice.turnCredential,
    });
  }

  const rt =
    typeof window !== 'undefined' ? window.__PEERLINK_ICE__ : undefined;
  // …（保留原有逻辑）
}
```

> `window.peerlink` 的类型来自新建的 `desktop-bridge.ts` 的 `declare global`；确保 `ice-config.ts` 所在编译上下文包含该声明（同属 `apps/web/src`，tsconfig `include: ["src"]` 已覆盖）。

- [ ] **Step 5: 运行验证通过**

Run: `pnpm --filter @peerlink/web test ice-config`
Expected: PASS。

- [ ] **Step 6: 改 `signalUrl()` 优先读 bridge**

`apps/web/src/core/conversation.ts:487`：

```ts
function signalUrl(): string {
  if (window.peerlink?.signalUrl) return window.peerlink.signalUrl; // 桌面端
  if (import.meta.env.VITE_SIGNAL_URL) return import.meta.env.VITE_SIGNAL_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const path = import.meta.env.VITE_SIGNAL_PATH ?? '/signal';
  return `${proto}://${location.host}${path}`;
}
```

需在 `conversation.ts` 顶部加 `import '@/lib/desktop-bridge';`（仅为引入 `declare global` 的 `Window.peerlink` 类型；若 lint 报无用导入，改成 `import type {} from '@/lib/desktop-bridge';` 或在文件内 `/// <reference />`）。

- [ ] **Step 7: 实现 preload**

`apps/desktop/src/preload/index.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron';

// 同步从主进程取启动配置（preload 早于页面脚本执行）
const bootstrap = ipcRenderer.sendSync('peerlink:bootstrap') as {
  signalUrl: string;
  signalDomain: string;
  ice: Record<string, string>;
};

const activateHandlers = new Set<(sessionId: string) => void>();
ipcRenderer.on('peerlink:activate-session', (_e, sessionId: string) => {
  activateHandlers.forEach(cb => cb(sessionId));
});

contextBridge.exposeInMainWorld('peerlink', {
  signalUrl: bootstrap.signalUrl,
  signalDomain: bootstrap.signalDomain,
  ice: bootstrap.ice,
  setSignalDomain: (domain: string) =>
    ipcRenderer.invoke('peerlink:set-signal-domain', domain),
  setIce: (ice: Record<string, string>) =>
    ipcRenderer.invoke('peerlink:set-ice', ice),
  notify: (payload: { title: string; body: string; sessionId: string }) =>
    ipcRenderer.send('peerlink:notify', payload),
  onActivateSession: (cb: (sessionId: string) => void) => {
    activateHandlers.add(cb);
  },
});
```

- [ ] **Step 8: 主进程加 IPC handler（bootstrap / set-signal-domain / set-ice）**

在 `apps/desktop/src/main/index.ts` 的 `app.whenReady` 内、`createWindow()` 之前注册：

```ts
import { domainFromSignalUrl } from './signal-url';
// …
ipcMain.on('peerlink:bootstrap', e => {
  const c = config.get();
  e.returnValue = {
    signalUrl: c.signalUrl,
    signalDomain: domainFromSignalUrl(c.signalUrl),
    ice: c.ice,
  };
});
ipcMain.handle('peerlink:set-signal-domain', (_e, domain: string) => {
  config.setSignalDomain(domain);
  mainWindow?.reload(); // 重载使新地址在所有新连接生效
});
ipcMain.handle('peerlink:set-ice', (_e, ice) => {
  config.setIce(ice);
  mainWindow?.reload();
});
```

（记得 `import { ipcMain } from 'electron'`。）

- [ ] **Step 9: 验证前端测试 + 双端 typecheck**

Run: `pnpm --filter @peerlink/web test && pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/desktop typecheck`
Expected: 全 PASS。

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/desktop-bridge.ts apps/web/src/lib/ice-config.ts apps/web/src/lib/ice-config.spec.ts apps/web/src/core/conversation.ts apps/desktop/src/preload apps/desktop/src/main/index.ts
git commit -m "feat(desktop): preload bridge + frontend ice/signal-url integration"
```

---

## Task 5: 屏幕共享源选择器

**Files:**

- Create: `apps/desktop/src/main/screen-picker.ts`
- Test: `apps/desktop/src/main/screen-picker.spec.ts`
- Create: `apps/desktop/src/picker/picker.html`
- Create: `apps/desktop/src/picker/picker.ts`
- Modify: `apps/desktop/src/main/index.ts`

设计：`setDisplayMediaRequestHandler(handler, { useSystemPicker: true })`。macOS 支持时 Electron 走系统选择器、handler 不被调用；其余平台调用 handler → 打开自带选择器窗口列出 `desktopCapturer` 源，用户选定后 `callback({ video: source })`，取消则 `callback({})`（前端 getDisplayMedia 会 reject，会议屏幕共享侧已有错误处理）。把"源列表 → 选择器展示数据"的转换抽成纯函数测试。

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/screen-picker.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { toPickerItems } from './screen-picker';

describe('toPickerItems', () => {
  it('把 desktopCapturer 源映射为选择器条目', () => {
    const sources = [
      { id: 'screen:0', name: 'Entire Screen', thumbnail: fakeThumb('a') },
      { id: 'window:12', name: 'VS Code', thumbnail: fakeThumb('b') },
    ];
    expect(toPickerItems(sources)).toEqual([
      {
        id: 'screen:0',
        name: 'Entire Screen',
        kind: 'screen',
        dataUrl: 'data:a',
      },
      { id: 'window:12', name: 'VS Code', kind: 'window', dataUrl: 'data:b' },
    ]);
  });
});

function fakeThumb(s: string) {
  return { toDataURL: () => `data:${s}` };
}
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @peerlink/desktop test screen-picker`
Expected: FAIL，找不到 `./screen-picker`。

- [ ] **Step 3: 实现**

`apps/desktop/src/main/screen-picker.ts`：

```ts
import { join } from 'node:path';

import {
  BrowserWindow,
  desktopCapturer,
  type DesktopCapturerSource,
  ipcMain,
  type Session,
} from 'electron';

export interface PickerItem {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  dataUrl: string;
}

interface ThumbLike {
  toDataURL(): string;
}

/** 纯函数：源列表 → 选择器 UI 数据。 */
export function toPickerItems(
  sources: { id: string; name: string; thumbnail: ThumbLike }[]
): PickerItem[] {
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    dataUrl: s.thumbnail.toDataURL(),
  }));
}

/** 弹自带选择器窗口，resolve 用户选中的源（取消则 undefined）。 */
function openPicker(
  parent: BrowserWindow,
  sources: DesktopCapturerSource[]
): Promise<DesktopCapturerSource | undefined> {
  return new Promise(resolve => {
    const picker = new BrowserWindow({
      parent,
      modal: true,
      width: 720,
      height: 520,
      title: '选择共享内容',
      webPreferences: { preload: join(__dirname, 'picker-preload.cjs') },
    });
    picker.loadFile(join(__dirname, 'picker.html'));

    const items = toPickerItems(sources);
    picker.webContents.once('did-finish-load', () => {
      picker.webContents.send('picker:items', items);
    });

    const onChoose = (_e: unknown, id: string | null) => {
      cleanup();
      resolve(id ? sources.find(s => s.id === id) : undefined);
      picker.close();
    };
    ipcMain.once('picker:choose', onChoose);
    function cleanup() {
      ipcMain.removeListener('picker:choose', onChoose);
    }
    picker.on('closed', () => {
      cleanup();
      resolve(undefined);
    });
  });
}

/** 注册屏幕共享 handler。macOS 支持时走系统选择器。 */
export function installScreenPicker(
  session: Session,
  getParent: () => BrowserWindow
): void {
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 200 },
        })
        .then(async sources => {
          const chosen = await openPicker(getParent(), sources);
          // chosen 为空 → 传空对象，前端 getDisplayMedia 将 reject
          callback(chosen ? { video: chosen } : {});
        });
    },
    { useSystemPicker: true }
  );
}
```

> 选择器需要自己的 preload（`picker-preload.cjs`）暴露 `items` 订阅与 `choose` 发送。Step 5 一并实现并在 build.mjs（Task 9）打包。

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @peerlink/desktop test screen-picker`
Expected: PASS。

- [ ] **Step 5: 选择器 UI + 其 preload**

`apps/desktop/src/picker/picker.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <style>
      body {
        font-family: system-ui;
        margin: 0;
        padding: 16px;
        background: #1a1714;
        color: #eee;
      }
      h2 {
        font-size: 15px;
        margin: 0 0 12px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }
      .item {
        border: 2px solid transparent;
        border-radius: 8px;
        padding: 6px;
        cursor: pointer;
        background: #262220;
      }
      .item:hover {
        border-color: #d98c4a;
      }
      .item img {
        width: 100%;
        height: 110px;
        object-fit: cover;
        border-radius: 4px;
      }
      .item span {
        display: block;
        font-size: 12px;
        margin-top: 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bar {
        margin-top: 16px;
        text-align: right;
      }
      button {
        background: #333;
        color: #eee;
        border: 0;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <h2>选择要共享的屏幕或窗口</h2>
    <div class="grid" id="grid"></div>
    <div class="bar"><button id="cancel">取消</button></div>
    <script src="./picker.js"></script>
  </body>
</html>
```

`apps/desktop/src/picker/picker.ts`：

```ts
interface Item {
  id: string;
  name: string;
  kind: string;
  dataUrl: string;
}

declare global {
  interface Window {
    picker: {
      onItems(cb: (items: Item[]) => void): void;
      choose(id: string | null): void;
    };
  }
}

const grid = document.getElementById('grid')!;
window.picker.onItems(items => {
  grid.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<img src="${it.dataUrl}" /><span>${it.name}</span>`;
    el.onclick = () => window.picker.choose(it.id);
    grid.appendChild(el);
  }
});
document.getElementById('cancel')!.onclick = () => window.picker.choose(null);

export {};
```

`apps/desktop/src/picker/picker-preload.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('picker', {
  onItems: (cb: (items: unknown) => void) =>
    ipcRenderer.on('picker:items', (_e, items) => cb(items)),
  choose: (id: string | null) => ipcRenderer.send('picker:choose', id),
});
```

- [ ] **Step 6: 在主进程接线**

`apps/desktop/src/main/index.ts` 的 `createWindow()` 末尾（窗口创建后）：

```ts
import { installScreenPicker } from './screen-picker';
// …在 createWindow() 内，mainWindow 创建后：
installScreenPicker(mainWindow.webContents.session, () => mainWindow!);
```

- [ ] **Step 7: 验证 typecheck**

Run: `pnpm --filter @peerlink/desktop typecheck`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/screen-picker.ts apps/desktop/src/main/screen-picker.spec.ts apps/desktop/src/picker apps/desktop/src/main/index.ts
git commit -m "feat(desktop): screen share source picker (custom window + macOS system picker)"
```

---

## Task 6: 托盘 + 后台常驻 + 单实例锁

**Files:**

- Create: `apps/desktop/src/main/tray.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/resources/tray-icon.png`（占位 PNG，建议 32×32/64×64；可先放任意小图标，发布前替换）

无纯逻辑可 TDD（全是 Electron 副作用），靠 typecheck + 手动冒烟。

- [ ] **Step 1: 实现 tray 模块**

`apps/desktop/src/main/tray.ts`：

```ts
import { join } from 'node:path';

import { app, BrowserWindow, Menu, Tray } from 'electron';

let tray: Tray | undefined;

interface TrayDeps {
  getWindow: () => BrowserWindow | undefined;
  isQuitting: () => boolean;
  requestQuit: () => void;
}

export function setupTray(deps: TrayDeps): void {
  tray = new Tray(join(__dirname, 'tray-icon.png'));
  tray.setToolTip('PeerLink');
  const show = () => {
    const win = deps.getWindow();
    if (win) {
      win.show();
      win.focus();
    }
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 PeerLink', click: show },
      { type: 'separator' },
      { label: '退出', click: () => deps.requestQuit() },
    ])
  );
  tray.on('click', show);
}

/** 拦截关窗：隐藏到托盘而非退出；真正退出由托盘菜单触发。 */
export function wireCloseToTray(
  win: BrowserWindow,
  isQuitting: () => boolean
): void {
  win.on('close', e => {
    if (!isQuitting()) {
      e.preventDefault();
      win.hide();
      if (process.platform === 'darwin') app.dock?.hide();
    }
  });
}
```

- [ ] **Step 2: 主进程接线（单实例 + 退出标志 + 托盘）**

`apps/desktop/src/main/index.ts` 顶部（`app.whenReady` 之前）：

```ts
import { setupTray, wireCloseToTray } from './tray';

let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('before-quit', () => {
  quitting = true;
});
```

改 `createWindow()`，窗口创建后：

```ts
wireCloseToTray(mainWindow, () => quitting);
```

`app.whenReady().then(...)` 内、`createWindow()` 之后：

```ts
setupTray({
  getWindow: () => mainWindow,
  isQuitting: () => quitting,
  requestQuit: () => {
    quitting = true;
    app.quit();
  },
});
```

删掉/改写原 `window-all-closed`：后台常驻下不应在关窗时退出：

```ts
app.on('window-all-closed', () => {
  // 后台常驻：不退出。退出只经托盘菜单 → before-quit → quit。
});
```

macOS dock 图标点击重新 show：

```ts
app.on('activate', () => {
  mainWindow?.show();
  app.dock?.show();
});
```

- [ ] **Step 3: 放占位托盘图标**

把任意 32×32 PNG 存到 `apps/desktop/resources/tray-icon.png`（build.mjs 会拷到 dist 旁）。发布前替换为正式图标。

- [ ] **Step 4: 验证 typecheck**

Run: `pnpm --filter @peerlink/desktop typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/tray.ts apps/desktop/src/main/index.ts apps/desktop/resources
git commit -m "feat(desktop): tray, close-to-tray background running, single-instance lock"
```

---

## Task 7: 原生通知 + 提示音

**Files:**

- Create: `apps/desktop/src/main/notifications.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/web/src/features/settings/desktop-notifications.ts`
- Test: `apps/web/src/features/settings/desktop-notifications.spec.ts`
- Modify: `apps/web/src/main.tsx`（启动时挂载通知订阅）

设计：**前端决定"该不该打扰"，主进程负责"弹 + 点击激活"**。前端订阅 `conversation-store`（已有"仅非活跃会话 +unread"语义），当总 unread 增加且 `document.hasFocus()` 为 false 时，调用 `bridge.notify(...)` 并播放一段 WebAudio 提示音。主进程展示通知，点击 → `mainWindow.show()` + 发 `peerlink:activate-session`。把"是否应通知"的判断抽成纯函数测试。

- [ ] **Step 1: 写失败测试（前端纯判断）**

`apps/web/src/features/settings/desktop-notifications.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { shouldNotify } from './desktop-notifications';

describe('shouldNotify', () => {
  it('unread 增加且窗口失焦时通知', () => {
    expect(shouldNotify({ prevUnread: 0, nextUnread: 1, focused: false })).toBe(
      true
    );
  });
  it('窗口有焦点时不通知', () => {
    expect(shouldNotify({ prevUnread: 0, nextUnread: 1, focused: true })).toBe(
      false
    );
  });
  it('unread 未增加时不通知', () => {
    expect(shouldNotify({ prevUnread: 2, nextUnread: 2, focused: false })).toBe(
      false
    );
  });
  it('unread 减少（已读）时不通知', () => {
    expect(shouldNotify({ prevUnread: 3, nextUnread: 1, focused: false })).toBe(
      false
    );
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @peerlink/web test desktop-notifications`
Expected: FAIL，找不到 `./desktop-notifications`。

- [ ] **Step 3: 实现前端订阅 + 提示音**

`apps/web/src/features/settings/desktop-notifications.ts`：

```ts
import { getBridge } from '@/lib/desktop-bridge';
import { useRoomsStore } from '@/state/conversation-store';

export function shouldNotify(args: {
  prevUnread: number;
  nextUnread: number;
  focused: boolean;
}): boolean {
  return args.nextUnread > args.prevUnread && !args.focused;
}

function totalUnread(sessions: Record<string, { unread: number }>): number {
  return Object.values(sessions).reduce((sum, s) => sum + s.unread, 0);
}

/** 找出 unread 刚增加的那条会话（用于通知点击跳转）。 */
function bumpedSessionId(
  prev: Record<string, { unread: number }>,
  next: Record<string, { unread: number }>
): string | undefined {
  return Object.keys(next).find(
    id => (next[id]?.unread ?? 0) > (prev[id]?.unread ?? 0)
  );
}

let beep: (() => void) | undefined;
function playBeep(): void {
  if (!beep) {
    const AudioCtx = window.AudioContext;
    beep = () => {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    };
  }
  beep();
}

/** 在桌面端启动时调用一次：订阅 store，按需弹原生通知。 */
export function installDesktopNotifications(): void {
  const bridge = getBridge();
  if (!bridge) return;

  // 通知点击 → 切到对应会话
  bridge.onActivateSession(id => useRoomsStore.getState().setActive(id));

  let prev = useRoomsStore.getState().sessions;
  useRoomsStore.subscribe(state => {
    const next = state.sessions;
    if (
      shouldNotify({
        prevUnread: totalUnread(prev),
        nextUnread: totalUnread(next),
        focused: document.hasFocus(),
      })
    ) {
      const id = bumpedSessionId(prev, next);
      if (id) {
        bridge.notify({ title: 'PeerLink', body: '收到新消息', sessionId: id });
        playBeep();
      }
    }
    prev = next;
  });
}
```

> 实现注意：确认 `conversation-store` 暴露 `sessions: Record<string, { unread: number; … }>` 与 `setActive(id)`（已确认存在）。`useRoomsStore.subscribe` 是 zustand 标准 API。

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @peerlink/web test desktop-notifications`
Expected: PASS。

- [ ] **Step 5: 启动时挂载**

`apps/web/src/main.tsx` 渲染前调用一次：

```ts
import { installDesktopNotifications } from '@/features/settings/desktop-notifications';
// …在 createRoot(...).render(...) 之前：
installDesktopNotifications();
```

- [ ] **Step 6: 主进程通知模块**

`apps/desktop/src/main/notifications.ts`：

```ts
import { BrowserWindow, Notification } from 'electron';

export function showNotification(
  payload: { title: string; body: string; sessionId: string },
  getWindow: () => BrowserWindow | undefined
): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: payload.title, body: payload.body });
  n.on('click', () => {
    const win = getWindow();
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('peerlink:activate-session', payload.sessionId);
    }
  });
  n.show();
}
```

主进程 `app.whenReady` 内注册：

```ts
import { showNotification } from './notifications';
// …
ipcMain.on('peerlink:notify', (_e, payload) =>
  showNotification(payload, () => mainWindow)
);
```

- [ ] **Step 7: 验证全量 typecheck + test**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web test && pnpm --filter @peerlink/desktop typecheck`
Expected: 全 PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/notifications.ts apps/desktop/src/main/index.ts apps/web/src/features/settings/desktop-notifications.ts apps/web/src/features/settings/desktop-notifications.spec.ts apps/web/src/main.tsx
git commit -m "feat(desktop): native notifications + beep on incoming message"
```

---

## Task 8: 桌面专属设置面板

**Files:**

- Create: `apps/web/src/features/settings/SettingsPanel.tsx`
- Modify: Inbox 顶部区域接入设置入口（实现时先 `grep -rn "Inbox" apps/web/src/features` 定位实际文件，常见为 `apps/web/src/features/inbox/Inbox.tsx`）

设置面板仅在 `isDesktop()` 为真时渲染入口。改信令域名 + ICE/TURN，保存调 `bridge.setSignalDomain` / `bridge.setIce`（主进程保存后重载窗口生效）。React 19 约定：无 forwardRef、`ref` 当普通 prop、named import。

- [ ] **Step 1: 实现设置面板组件**

`apps/web/src/features/settings/SettingsPanel.tsx`：

```tsx
import { useState } from 'react';

import { getBridge } from '@/lib/desktop-bridge';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const bridge = getBridge();
  const [domain, setDomain] = useState(bridge?.signalDomain ?? '');
  const [stun, setStun] = useState(bridge?.ice.stunUrls ?? '');
  const [turnUrl, setTurnUrl] = useState(bridge?.ice.turnUrl ?? '');
  const [turnUser, setTurnUser] = useState(bridge?.ice.turnUsername ?? '');
  const [turnCred, setTurnCred] = useState(bridge?.ice.turnCredential ?? '');
  const [saving, setSaving] = useState(false);

  if (!bridge) return null;

  async function save() {
    setSaving(true);
    await bridge!.setIce({
      stunUrls: stun,
      turnUrl,
      turnUsername: turnUser,
      turnCredential: turnCred,
    });
    await bridge!.setSignalDomain(domain); // 最后存域名 → 触发重载
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[480px] rounded-lg bg-surface p-6 text-sm">
        <h2 className="mb-4 text-base font-semibold">设置</h2>

        <label className="mb-1 block text-muted">信令服务器域名</label>
        <input
          className="mb-1 w-full rounded-md border border-line bg-transparent px-3 py-2"
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="peerlink.qinjiapeng.com"
        />
        <p className="mb-4 text-xs text-muted">
          只填域名即可，应用会自动补全 wss:// 与 /signal。保存后会重新连接。
        </p>

        <label className="mb-1 block text-muted">STUN（逗号分隔，可空）</label>
        <input
          className="mb-3 w-full rounded-md border border-line bg-transparent px-3 py-2"
          value={stun}
          onChange={e => setStun(e.target.value)}
        />

        <label className="mb-1 block text-muted">TURN URL（可空）</label>
        <input
          className="mb-3 w-full rounded-md border border-line bg-transparent px-3 py-2"
          value={turnUrl}
          onChange={e => setTurnUrl(e.target.value)}
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <input
            className="rounded-md border border-line bg-transparent px-3 py-2"
            placeholder="TURN 用户名"
            value={turnUser}
            onChange={e => setTurnUser(e.target.value)}
          />
          <input
            className="rounded-md border border-line bg-transparent px-3 py-2"
            placeholder="TURN 凭据"
            value={turnCred}
            onChange={e => setTurnCred(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button className="rounded-md px-4 py-2 text-muted" onClick={onClose}>
            取消
          </button>
          <button
            className="rounded-md bg-accent px-4 py-2 font-medium disabled:opacity-50"
            disabled={saving}
            onClick={save}
          >
            {saving ? '保存并重连…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

> className 用到的 `bg-surface`/`text-muted`/`border-line`/`bg-accent` 等需对齐项目实际主题 token——实现时 `grep -rn "bg-surface\|text-muted\|border-line\|bg-accent" apps/web/src` 确认存在，不存在则换成项目里真实的等价 token。优先标准 utility，避免 `[...]` 任意值。

- [ ] **Step 2: Inbox 接入设置入口（仅桌面端）**

先定位 Inbox 组件：`grep -rln "Inbox\|inbox" apps/web/src/features`。在其顶部工具区加一个齿轮按钮，仅 `isDesktop()` 时渲染，点开切换 `SettingsPanel`：

```tsx
import { useState } from 'react';
import { Settings } from 'lucide-react';

import { isDesktop } from '@/lib/desktop-bridge';
import { SettingsPanel } from '@/features/settings/SettingsPanel';

// 在 Inbox 组件内：
const [showSettings, setShowSettings] = useState(false);
// …在标题栏渲染：
{
  isDesktop() && (
    <button aria-label="设置" onClick={() => setShowSettings(true)}>
      <Settings className="size-4" />
    </button>
  );
}
{
  showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />;
}
```

- [ ] **Step 3: 验证 typecheck + lint + build**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web lint && pnpm --filter @peerlink/web build`
Expected: 全 PASS（build 产出 `apps/web/dist`，后续打包要用）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/settings/SettingsPanel.tsx apps/web/src/features
git commit -m "feat(web): desktop-only settings panel for signaling + ICE config"
```

---

## Task 9: esbuild 打包脚本 + dev 工作流

**Files:**

- Create: `apps/desktop/build.mjs`
- Modify: `apps/desktop/package.json`（dev 脚本换成 concurrently；scripts 调整）
- 安装 `concurrently`

- [ ] **Step 1: 写 build.mjs**

`apps/desktop/build.mjs`（参考 `apps/signaling/build.mjs` 的 esbuild 用法风格）：

```js
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, 'dist');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

const entries = [
  { in: join(here, 'src/main/index.ts'), out: 'main' },
  { in: join(here, 'src/preload/index.ts'), out: 'preload' },
  { in: join(here, 'src/picker/picker-preload.ts'), out: 'picker-preload' },
];

const browserEntry = {
  entryPoints: [join(here, 'src/picker/picker.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: join(outdir, 'picker.js'),
  sourcemap: true,
};

mkdirSync(outdir, { recursive: true });

async function build() {
  for (const e of entries) {
    const cfg = {
      ...common,
      entryPoints: [e.in],
      outfile: join(outdir, `${e.out}.cjs`),
    };
    if (watch) await (await esbuild.context(cfg)).watch();
    else await esbuild.build(cfg);
  }
  if (watch) await (await esbuild.context(browserEntry)).watch();
  else await esbuild.build(browserEntry);

  // 静态资源
  cpSync(join(here, 'src/picker/picker.html'), join(outdir, 'picker.html'));
  cpSync(join(here, 'resources/tray-icon.png'), join(outdir, 'tray-icon.png'));
  // 生产 renderer：拷贝 web 构建产物
  cpSync(join(here, '../web/dist'), join(outdir, 'renderer'), {
    recursive: true,
  });
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
```

> 注意：`tray.ts` 里 `join(__dirname, 'tray-icon.png')`、`screen-picker.ts` 里 `picker.html`/`picker-preload.cjs` 都解析到 `dist/`，与上面拷贝目标一致。

- [ ] **Step 2: 安装 concurrently，改 dev/build 脚本**

```bash
cd apps/desktop && pnpm add -D concurrently@latest
```

把 `apps/desktop/package.json` scripts 改为：

```jsonc
{
  "scripts": {
    "build": "node build.mjs",
    "dev": "concurrently -k \"pnpm --filter @peerlink/web dev\" \"node build.mjs --watch\" \"wait-on http://localhost:5173 dist/main.cjs && electron .\"",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "dist": "pnpm --filter @peerlink/web build && node build.mjs && electron-builder",
  },
}
```

把 `concurrently` 提到 catalog（同 Task 0 Step 4 做法）。

- [ ] **Step 3: 本地冒烟（dev）**

Run: `pnpm --filter @peerlink/desktop dev`
Expected: Vite 起在 5173、esbuild 产出 `dist/main.cjs`、Electron 窗口打开并加载 dev 前端。手动确认：窗口出现、能进入应用 UI。
（信令默认指向 `peerlink.qinjiapeng.com`；本地若无该服务，连接失败属预期，UI 仍应渲染。）

- [ ] **Step 4: 本地冒烟（prod 加载路径）**

```bash
pnpm --filter @peerlink/web build
pnpm --filter @peerlink/desktop build
cd apps/desktop && npx electron . # app.isPackaged 为 false 仍走 DEV_URL；
```

> 注意：未打包时 `app.isPackaged` 为 false 会走 dev URL。要单独验证 `app://` 加载，可临时在 `index.ts` 用环境变量 `FORCE_PROD=1` 强制走 `APP_ORIGIN`，验证后移除。这一步可选，主验证留给 Task 10 的真实打包产物。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/build.mjs apps/desktop/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build(desktop): esbuild bundling + concurrently dev workflow"
```

---

## Task 10: electron-builder 三平台分发配置

**Files:**

- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/resources/icon.png`（应用图标，512×512+；可先占位）

- [ ] **Step 1: 写 electron-builder.yml**

`apps/desktop/electron-builder.yml`：

```yaml
appId: com.qinjiapeng.peerlink
productName: PeerLink
directories:
  output: release
files:
  - dist/**
  - package.json
# dist/renderer 由 build.mjs 拷入，已被 dist/** 覆盖
mac:
  target:
    - target: dmg
      arch: [universal]
  category: public.app-category.social-networking
  icon: resources/icon.png
win:
  target:
    - target: nsis
      arch: [x64]
  icon: resources/icon.png
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
linux:
  target:
    - AppImage
    - deb
  category: Network
  icon: resources/icon.png
```

> `files` 仅含 `dist/**` + `package.json`：main/preload/picker/renderer 全在 `dist`。`node_modules` 不必显式列（electron-builder 自动纳入生产依赖；本包运行时无第三方依赖，纯 Electron API）。

- [ ] **Step 2: 本地打当前平台包验证**

Run（在 Linux 开发机）：`pnpm --filter @peerlink/desktop dist`
Expected: `apps/desktop/release/` 下生成 `.AppImage` 与 `.deb`。安装/运行 AppImage：窗口打开、加载打包进去的前端（`app://`）、UI 正常渲染。

> macOS/Windows 产物需在对应 OS 或 CI matrix 上构建（Task 11）。本地仅验证当前平台。

- [ ] **Step 3: 冒烟核对（当前平台真实产物）**

逐项手动确认（这是 Phase 1 的验收清单，无自动化）：

- [ ] 应用启动、显示前端 UI
- [ ] 设置面板：改信令域名 → 保存 → 窗口重载、新地址生效（可在设置里填一个本地可达的信令做端到端验证）
- [ ] 关闭窗口 → 隐藏到托盘、进程不退出；托盘菜单"打开"能恢复；"退出"真正结束进程
- [ ] 两个实例：再次启动只聚焦已有窗口
- [ ] 屏幕共享：会议中发起共享 → 弹自带选择器（Linux/Win）→ 选屏后对端能看到画面
- [ ] 通知：窗口失焦时来消息 → 弹原生系统通知 + 提示音；点通知 → 窗口前置并切到该会话

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/resources/icon.png
git commit -m "build(desktop): electron-builder config for win/mac/linux"
```

---

## Task 11: Turbo 接线 + GitHub Actions 发布

**Files:**

- Modify: `turbo.json`（可选，给 desktop 加专用 task）
- Create: `.github/workflows/desktop-release.yml`

- [ ] **Step 1: 确认 turbo build 链路**

`turbo.json` 的 `build` 已 `dependsOn: ["^build"]`，`@peerlink/desktop` 依赖 `@peerlink/web`，故 `turbo build` 会先构建 web。验证：

Run: `pnpm build`
Expected: 包含 `@peerlink/desktop#build` 且在 `@peerlink/web#build` 之后；`apps/desktop/dist` 含 `renderer/`。

> 若希望 `pnpm build` 不连带跑 electron-builder（重），保持 desktop 的 `build` 只做 esbuild（现状），`dist` 单独手动/CI 触发即可，无需改 turbo.json。

- [ ] **Step 2: 写发布 workflow**

`.github/workflows/desktop-release.yml`：

```yaml
name: Desktop Release
on:
  push:
    tags: ['v*.*.*']
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @peerlink/web build
      - run: pnpm --filter @peerlink/desktop build
      - run: pnpm --filter @peerlink/desktop exec electron-builder --publish never
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: softprops/action-gh-release@v2
        with:
          files: apps/desktop/release/*.{AppImage,deb,dmg,exe}
```

> Phase 1 不签名：macOS/Windows 产物未签名（用户首次打开需绕过 Gatekeeper / SmartScreen）。签名与 electron-updater 自动更新归 Phase 2。

- [ ] **Step 3: 提交（不触发发布，仅入库）**

```bash
git add turbo.json .github/workflows/desktop-release.yml
git commit -m "ci(desktop): matrix build + release workflow on version tags"
```

> 真正出包由后续打 `v*.*.*` tag 触发，不在本计划执行范围内。

---

## Self-Review 记录

- **Spec 覆盖**：选型(Electron)✓Task 全程；不 fork 前端✓Task4；app://加载✓Task3；bridge✓Task4；配置存储+域名规范化✓Task1/2；window.peerlink 注入(绕开 ice-config.js 覆盖)✓Task4；设置面板(仅桌面)✓Task8；屏幕选择器(自带+macOS系统)✓Task5；托盘后台常驻+单实例✓Task6；原生通知+声音✓Task7；electron-builder 三平台(mac universal / linux AppImage+deb)✓Task10；CI tag 触发✓Task11；签名/自动更新归 Phase2✓Task10/11 注明；协议层不变✓全程未触碰 `packages/protocol`/`apps/signaling`。
- **占位符**：无 TBD；每个改动步骤含真实代码与命令。
- **类型一致性**：`PeerlinkBridge`(Task4) 与 preload 暴露面(Task4 Step7)、SettingsPanel 调用(Task8) 字段一致（signalUrl/signalDomain/ice/setSignalDomain/setIce/notify/onActivateSession）；`ConfigStore`(Task2) 的 `get/setSignalDomain/setIce` 与主进程 IPC(Task4 Step8) 调用一致；`installScreenPicker`/`toPickerItems`(Task5) 与接线一致。
- **已知需实现期核对的点**（计划内已标注）：Inbox 实际文件名、主题 token 名称、`apps/signaling` 的 esbuild/eslint 写法风格、Electron latest 版本下 `protocol.handle` 可用性。
