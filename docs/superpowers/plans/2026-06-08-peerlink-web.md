# PeerLink @peerlink/web 实现计划（计划 3 / 3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Web 客户端 `@peerlink/web`：连接信令服务完成 WebRTC P2P 配对，支持多文件 / 文件夹 / GB 级大文件的分片流式传输、背压控制、CRC32 校验，接收端按浏览器能力选择 File System Access / ZIP / Blob 写入。

**Architecture:** React 19 + Vite + Tailwind v4 + TanStack Router + zustand。分层：纯逻辑（`ice-config`、`signaling-client`、`sender`、`receiver`、`storage` 写入器、能力探测）依赖注入、可纯单测；浏览器 API 封装（`peer-connection`、FS Access / ZIP 写入器）薄、用 mock/E2E 验证；UI 仅编排。E2E 用 Playwright 双浏览器跑真实 localhost WebRTC。

**Tech Stack:** React 19、Vite、Tailwind v4、TanStack Router、zustand、sonner、lucide-react、qrcode、@zip.js/zip.js、`@peerlink/protocol`、Vitest（jsdom）、Playwright。

**前置:** 计划 1（`@peerlink/protocol`）、计划 2（`@peerlink/signaling` 可在 `/signal` 提供 WebSocket）。

**关联 spec:** 第 2.3 客户端分层、4.1–4.6 传输协议、5.x 错误处理与降级、6.3–6.4 测试。

**初始化约定:** 与计划 2 一致——**收到 `peer-joined` 的一方是发起方**（创建 DataChannel + offer）；另一方在收到 offer（`signal`）后建立连接并应答。

---

## 文件结构

```
apps/web/
├── package.json / index.html / vite.config.ts / vitest.config.ts          [Task 1]
├── tsconfig.json / tsconfig.node.json / eslint.config.js                  [Task 1]
├── playwright.config.ts                                                   [Task 12]
├── e2e/transfer.spec.ts                                                   [Task 12]
└── src/
    ├── main.tsx / index.css / vite-env.d.ts                               [Task 1,11]
    ├── lib/
    │   ├── cn.ts                                                          [Task 1]
    │   └── ice-config.ts (+ .spec)                                        [Task 2]
    ├── core/
    │   ├── signaling-client.ts (+ .spec)                                  [Task 3]
    │   ├── channel.ts                                                     [Task 4]
    │   ├── sender.ts (+ .spec)                                            [Task 5]
    │   ├── receiver.ts (+ .spec)                                          [Task 6]
    │   ├── peer-connection.ts (+ .spec)                                   [Task 9]
    │   └── storage/
    │       ├── writer.ts (+ .spec)        # Writer 接口 + 能力探测 + 工厂   [Task 7]
    │       ├── blob-writer.ts (+ .spec)                                   [Task 7]
    │       ├── fs-access-writer.ts                                        [Task 8]
    │       └── zip-writer.ts                                              [Task 8]
    ├── state/store.ts (+ .spec)                                           [Task 10]
    ├── features/send/*.tsx  features/receive/*.tsx                        [Task 11]
    └── routes/*.tsx                                                       [Task 11]
```

修改：`docker-compose.yml`（接入 web 服务）[Task 13]。

---

## Task 1: 搭出 `apps/web` 包骨架

**Files:**
- Create: `apps/web/package.json`, `index.html`, `vite.config.ts`, `vitest.config.ts`
- Create: `apps/web/tsconfig.json`, `tsconfig.node.json`, `eslint.config.js`
- Create: `apps/web/src/main.tsx`, `src/index.css`, `src/vite-env.d.ts`, `src/lib/cn.ts`

- [ ] **Step 1: 创建 `apps/web/package.json`**

```json
{
  "name": "@peerlink/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b --noEmit && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@peerlink/protocol": "workspace:*",
    "@tanstack/react-router": "catalog:",
    "@zip.js/zip.js": "catalog:",
    "clsx": "catalog:",
    "lucide-react": "catalog:",
    "qrcode": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "sonner": "catalog:",
    "tailwind-merge": "catalog:",
    "zustand": "catalog:"
  },
  "devDependencies": {
    "@eslint/js": "catalog:",
    "@playwright/test": "catalog:",
    "@tailwindcss/vite": "catalog:",
    "@tanstack/router-plugin": "catalog:",
    "@types/node": "catalog:",
    "@types/qrcode": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "eslint": "catalog:",
    "eslint-plugin-react-hooks": "catalog:",
    "eslint-plugin-react-refresh": "catalog:",
    "eslint-plugin-simple-import-sort": "catalog:",
    "globals": "catalog:",
    "jsdom": "^25.0.1",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "typescript-eslint": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: 创建 `apps/web/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PeerLink · 点对点文件传输</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: 创建 `apps/web/tsconfig.json` 与 `tsconfig.node.json`**

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "node"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "noEmit": true
  },
  "include": ["src", "e2e"]
}
```

`apps/web/tsconfig.node.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "noEmit": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 4: 创建 `apps/web/vite.config.ts`**

```ts
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const traefikPort = Number(env.TRAEFIK_PORT ?? 8894);
  const insideDocker = env.RUNNING_IN_DOCKER === '1';

  return {
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      hmr: insideDocker ? { clientPort: traefikPort } : true,
      proxy: insideDocker
        ? undefined
        : {
            // 原生（非 docker）开发时把 /signal 代理到本地信令服务
            '/signal': {
              target: env.VITE_SIGNAL_TARGET ?? 'ws://localhost:3001',
              ws: true,
              changeOrigin: true,
            },
          },
    },
  };
});
```

- [ ] **Step 5: 创建 `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    environment: 'jsdom',
  },
});
```

- [ ] **Step 6: 创建 `apps/web/eslint.config.js`**

```js
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig } from 'eslint/config';

import { baseConfig } from '../../eslint.config.base.mjs';

export default defineConfig(
  { ignores: ['dist', 'src/routeTree.gen.ts'] },
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^react', '^react-dom'],
            ['^@?\\w'],
            ['^@peerlink/'],
            ['^@/'],
            ['^\\.\\./|^\\./'],
            ['^.+\\.css$'],
          ],
        },
      ],
    },
  }
);
```

- [ ] **Step 7: 创建 `apps/web/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STUN_URLS?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  readonly VITE_SIGNAL_PATH?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 8: 创建 `apps/web/src/index.css`**

```css
@import 'tailwindcss';

:root {
  color-scheme: light dark;
}
body {
  margin: 0;
}
```

- [ ] **Step 9: 创建 `apps/web/src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 10: 创建占位 `apps/web/src/main.tsx`（Task 11 替换为路由版）**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div>PeerLink</div>
  </StrictMode>
);
```

- [ ] **Step 11: 安装并验证**

Run: `pnpm install && pnpm --filter @peerlink/web typecheck`
Expected: 安装成功；typecheck PASS（TanStack Router 插件首次运行会生成 `src/routeTree.gen.ts`，若此时报缺失，先建空文件 `export const routeTree = undefined as never;` 占位，Task 11 由插件覆盖）。

- [ ] **Step 12: 提交**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "chore: scaffold @peerlink/web app"
```

---

## Task 2: ICE 配置（可插拔 TURN，TDD）

**Files:**
- Create: `apps/web/src/lib/ice-config.spec.ts`, `apps/web/src/lib/ice-config.ts`

- [ ] **Step 1: 写失败测试 `apps/web/src/lib/ice-config.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { buildIceServers } from './ice-config';

describe('buildIceServers', () => {
  it('falls back to a default STUN when none provided', () => {
    const servers = buildIceServers({});
    expect(servers).toHaveLength(1);
    expect(servers[0].urls).toContain('stun:stun.l.google.com:19302');
  });

  it('parses comma-separated STUN urls', () => {
    const servers = buildIceServers({ VITE_STUN_URLS: 'stun:a:1, stun:b:2' });
    expect(servers[0].urls).toEqual(['stun:a:1', 'stun:b:2']);
  });

  it('appends a TURN server with credentials when configured', () => {
    const servers = buildIceServers({
      VITE_STUN_URLS: 'stun:a:1',
      VITE_TURN_URL: 'turn:t:3478',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'p',
    });
    expect(servers).toHaveLength(2);
    expect(servers[1]).toEqual({
      urls: 'turn:t:3478',
      username: 'u',
      credential: 'p',
    });
  });

  it('omits TURN when url is empty', () => {
    const servers = buildIceServers({ VITE_TURN_URL: '' });
    expect(servers.every(s => String(s.urls).startsWith('stun'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/web test ice-config`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/web/src/lib/ice-config.ts`**

```ts
export interface IceConfigEnv {
  VITE_STUN_URLS?: string;
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

/** 由环境变量构建 ICE 服务器列表；TURN 可选（可插拔，留空仅用 STUN）。 */
export function buildIceServers(env: IceConfigEnv): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun = (env.VITE_STUN_URLS ?? DEFAULT_STUN)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (stun.length) servers.push({ urls: stun });
  if (env.VITE_TURN_URL && env.VITE_TURN_URL.trim()) {
    servers.push({
      urls: env.VITE_TURN_URL.trim(),
      username: env.VITE_TURN_USERNAME,
      credential: env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}

/** 运行时入口：从 import.meta.env 读取。 */
export function iceServersFromEnv(): RTCIceServer[] {
  return buildIceServers(import.meta.env);
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/web test ice-config`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/ice-config.ts apps/web/src/lib/ice-config.spec.ts
git commit -m "feat(web): add pluggable ICE/TURN config builder"
```

---

## Task 3: 信令客户端 SignalingClient（TDD，mock WS）

**Files:**
- Create: `apps/web/src/core/signaling-client.spec.ts`, `apps/web/src/core/signaling-client.ts`

> 事件式封装：入站经 `serverMessageSchema` 校验，非法消息忽略；出站构造 `ClientMessage`。`WebSocket` 构造器可注入以便测试。

- [ ] **Step 1: 写失败测试 `apps/web/src/core/signaling-client.spec.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

import { SignalingClient, type WebSocketLike } from './signaling-client';

class MockWS implements WebSocketLike {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 1;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function setup() {
  let ws!: MockWS;
  const client = new SignalingClient('ws://x/signal', {
    createSocket: url => (ws = new MockWS(url)),
  });
  return { client, getWs: () => ws };
}

describe('SignalingClient', () => {
  it('sends a create-room message', () => {
    const { client, getWs } = setup();
    client.createRoom();
    expect(JSON.parse(getWs().sent[0])).toEqual({ type: 'create-room' });
  });

  it('sends join-room with the roomId', () => {
    const { client, getWs } = setup();
    client.joinRoom('8423-河马');
    expect(JSON.parse(getWs().sent[0])).toEqual({
      type: 'join-room',
      roomId: '8423-河马',
    });
  });

  it('emits room-created on a valid incoming message', () => {
    const { client, getWs } = setup();
    const cb = vi.fn();
    client.on('room-created', cb);
    getWs().emit({ type: 'room-created', roomId: 'r1' });
    expect(cb).toHaveBeenCalledWith('r1');
  });

  it('emits signal with from + payload', () => {
    const { client, getWs } = setup();
    const cb = vi.fn();
    client.on('signal', cb);
    getWs().emit({ type: 'signal', from: 'p2', payload: { sdp: 'X' } });
    expect(cb).toHaveBeenCalledWith('p2', { sdp: 'X' });
  });

  it('ignores malformed incoming messages', () => {
    const { client, getWs } = setup();
    const cb = vi.fn();
    client.on('error', cb);
    getWs().emit({ type: 'totally-unknown' });
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/web test signaling-client`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/web/src/core/signaling-client.ts`**

```ts
import {
  type ClientMessage,
  type SignalErrorCode,
  serverMessageSchema,
} from '@peerlink/protocol';

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

interface SignalPayload {
  [k: string]: unknown;
}

interface Events {
  open: () => void;
  close: () => void;
  'room-created': (roomId: string) => void;
  'peer-joined': (peerId: string) => void;
  'peer-left': (peerId: string) => void;
  'lan-peers': (peers: { peerId: string; name: string }[]) => void;
  signal: (from: string, payload: SignalPayload) => void;
  error: (code: SignalErrorCode, message: string) => void;
}

type Handlers = { [K in keyof Events]: Set<Events[K]> };

export interface SignalingClientOptions {
  createSocket?: (url: string) => WebSocketLike;
}

export class SignalingClient {
  private ws: WebSocketLike;
  private handlers: Handlers = {
    open: new Set(),
    close: new Set(),
    'room-created': new Set(),
    'peer-joined': new Set(),
    'peer-left': new Set(),
    'lan-peers': new Set(),
    signal: new Set(),
    error: new Set(),
  };

  constructor(url: string, opts: SignalingClientOptions = {}) {
    const create =
      opts.createSocket ??
      ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
    this.ws = create(url);
    this.ws.onopen = () => this.emit('open');
    this.ws.onclose = () => this.emit('close');
    this.ws.onmessage = ev => this.onMessage(ev.data);
  }

  on<K extends keyof Events>(event: K, cb: Events[K]): () => void {
    this.handlers[event].add(cb);
    return () => this.handlers[event].delete(cb);
  }

  createRoom(): void {
    this.send({ type: 'create-room' });
  }
  joinRoom(roomId: string): void {
    this.send({ type: 'join-room', roomId });
  }
  lanInvite(targetPeerId: string): void {
    this.send({ type: 'lan-invite', targetPeerId });
  }
  signal(to: string, payload: SignalPayload): void {
    this.send({ type: 'signal', to, payload } as ClientMessage);
  }
  close(): void {
    this.ws.close();
  }

  private send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  private emit<K extends keyof Events>(
    event: K,
    ...args: Parameters<Events[K]>
  ): void {
    for (const cb of this.handlers[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }

  private onMessage(data: string): void {
    let msg;
    try {
      msg = serverMessageSchema.parse(JSON.parse(data));
    } catch {
      return; // 非法消息忽略
    }
    switch (msg.type) {
      case 'room-created':
        return this.emit('room-created', msg.roomId);
      case 'peer-joined':
        return this.emit('peer-joined', msg.peerId);
      case 'peer-left':
        return this.emit('peer-left', msg.peerId);
      case 'lan-peers':
        return this.emit('lan-peers', msg.peers);
      case 'signal':
        return this.emit('signal', msg.from, msg.payload as SignalPayload);
      case 'error':
        return this.emit('error', msg.code, msg.message);
    }
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/web test signaling-client`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/signaling-client.ts apps/web/src/core/signaling-client.spec.ts
git commit -m "feat(web): add typed signaling client"
```

---

## Task 4: 发送通道抽象 + DataChannel 适配器

**Files:**
- Create: `apps/web/src/core/channel.ts`

> `SendChannel` 抽象出发送端所需的最小能力（发送 + 缓冲量 + 等待排空），便于对 `sender` 做纯单测；`rtcSendChannel` 是基于真实 `RTCDataChannel` 的适配器。

- [ ] **Step 1: 实现 `apps/web/src/core/channel.ts`**

```ts
export interface SendChannel {
  send(data: Uint8Array): void;
  /** 当前发送缓冲字节数。 */
  readonly bufferedAmount: number;
  /** 缓冲量降到 threshold 及以下时 resolve。 */
  waitForDrain(threshold: number): Promise<void>;
}

/** 基于真实 RTCDataChannel 的发送通道适配器。 */
export function rtcSendChannel(dc: RTCDataChannel): SendChannel {
  return {
    send(data) {
      dc.send(data);
    },
    get bufferedAmount() {
      return dc.bufferedAmount;
    },
    waitForDrain(threshold) {
      if (dc.bufferedAmount <= threshold) return Promise.resolve();
      return new Promise(resolve => {
        dc.bufferedAmountLowThreshold = threshold;
        const handler = () => {
          dc.removeEventListener('bufferedamountlow', handler);
          resolve();
        };
        dc.addEventListener('bufferedamountlow', handler);
      });
    },
  };
}
```

- [ ] **Step 2: typecheck + 提交**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS。

```bash
git add apps/web/src/core/channel.ts
git commit -m "feat(web): add send-channel abstraction and RTCDataChannel adapter"
```

---

## Task 5: 发送端 TransferSender（背压 + CRC，TDD）

**Files:**
- Create: `apps/web/src/core/sender.spec.ts`, `apps/web/src/core/sender.ts`

> `TransferSender` 把一组 `SourceFile` 分片发送：每块 `encodeDataFrame`，每文件结束发 `file-complete{crc32}`，全部结束发 `transfer-complete`；`bufferedAmount` 超高水位时 `waitForDrain` 到低水位。manifest/accept 握手由上层编排（见 Task 11），本类只负责数据流。

- [ ] **Step 1: 写失败测试 `apps/web/src/core/sender.spec.ts`**

```ts
import { decodeFrame } from '@peerlink/protocol';
import { describe, expect, it } from 'vitest';

import type { SendChannel } from './channel';
import { buildManifest, type SourceFile, TransferSender } from './sender';

function memSource(fileId: number, path: string, bytes: number[]): SourceFile {
  const data = new Uint8Array(bytes);
  return {
    fileId,
    name: path.split('/').pop()!,
    size: data.length,
    relativePath: path,
    slice: async (start, end) => data.subarray(start, end),
  };
}

class RecordingChannel implements SendChannel {
  frames: Uint8Array[] = [];
  bufferedAmount = 0;
  send(data: Uint8Array) {
    this.frames.push(data.slice());
  }
  waitForDrain() {
    return Promise.resolve();
  }
}

describe('buildManifest', () => {
  it('sums total size and lists entries', () => {
    const m = buildManifest([
      memSource(0, 'a.txt', [1, 2, 3]),
      memSource(1, 'dir/b.txt', [4, 5]),
    ]);
    expect(m.type).toBe('manifest');
    expect(m.totalSize).toBe(5);
    expect(m.files[1]).toEqual({
      fileId: 1,
      name: 'b.txt',
      size: 2,
      relativePath: 'dir/b.txt',
    });
  });
});

describe('TransferSender', () => {
  it('emits data chunks then file-complete then transfer-complete', async () => {
    const ch = new RecordingChannel();
    const files = [memSource(0, 'a.bin', [10, 20, 30, 40, 50])];
    const sender = new TransferSender(ch, files, { chunkSize: 2 });
    await sender.streamAll();

    const decoded = ch.frames.map(decodeFrame);
    const dataFrames = decoded.filter(f => f.kind === 'data');
    // 5 字节、块大小 2 → 3 个数据块
    expect(dataFrames).toHaveLength(3);

    const controls = decoded.filter(f => f.kind === 'control');
    const types = controls.map(c =>
      c.kind === 'control' ? (c.message as { type: string }).type : ''
    );
    expect(types).toEqual(['file-complete', 'transfer-complete']);

    // 重组数据应等于源
    const payload = dataFrames.flatMap(f =>
      f.kind === 'data' ? Array.from(f.payload) : []
    );
    expect(payload).toEqual([10, 20, 30, 40, 50]);
  });

  it('reports progress monotonically up to total', async () => {
    const ch = new RecordingChannel();
    const files = [memSource(0, 'a.bin', [1, 2, 3, 4])];
    const seen: number[] = [];
    const sender = new TransferSender(ch, files, {
      chunkSize: 2,
      onProgress: sent => seen.push(sent),
    });
    await sender.streamAll();
    expect(seen[seen.length - 1]).toBe(4);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });

  it('waits for drain when buffered amount exceeds high watermark', async () => {
    let drainCalls = 0;
    const ch: SendChannel = {
      bufferedAmount: 10_000,
      send() {},
      waitForDrain: async () => {
        drainCalls++;
      },
    };
    const files = [memSource(0, 'a.bin', [1, 2, 3, 4, 5, 6])];
    const sender = new TransferSender(ch, files, {
      chunkSize: 2,
      highWater: 1000,
      lowWater: 500,
    });
    await sender.streamAll();
    expect(drainCalls).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/web test sender`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/web/src/core/sender.ts`**

```ts
import {
  BUFFER_HIGH_WATERMARK,
  BUFFER_LOW_WATERMARK,
  Crc32,
  DEFAULT_CHUNK_SIZE,
  encodeControlFrame,
  encodeDataFrame,
  type FileEntry,
} from '@peerlink/protocol';

import type { SendChannel } from './channel';

export interface SourceFile {
  fileId: number;
  name: string;
  size: number;
  relativePath: string;
  /** 返回 [start, end) 的字节。 */
  slice(start: number, end: number): Promise<Uint8Array>;
}

export interface ManifestMessage {
  type: 'manifest';
  files: FileEntry[];
  totalSize: number;
}

export function buildManifest(files: SourceFile[]): ManifestMessage {
  return {
    type: 'manifest',
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    files: files.map(f => ({
      fileId: f.fileId,
      name: f.name,
      size: f.size,
      relativePath: f.relativePath,
    })),
  };
}

/** 把浏览器 File 转为 SourceFile（保留 webkitRelativePath 的目录）。 */
export function browserFileToSource(file: File, fileId: number): SourceFile {
  const rel =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name;
  return {
    fileId,
    name: file.name,
    size: file.size,
    relativePath: rel,
    slice: async (start, end) =>
      new Uint8Array(await file.slice(start, end).arrayBuffer()),
  };
}

export interface TransferSenderOptions {
  chunkSize?: number;
  highWater?: number;
  lowWater?: number;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

export class TransferSender {
  private chunkSize: number;
  private highWater: number;
  private lowWater: number;
  private onProgress?: TransferSenderOptions['onProgress'];
  private totalBytes: number;

  constructor(
    private channel: SendChannel,
    private files: SourceFile[],
    opts: TransferSenderOptions = {}
  ) {
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.highWater = opts.highWater ?? BUFFER_HIGH_WATERMARK;
    this.lowWater = opts.lowWater ?? BUFFER_LOW_WATERMARK;
    this.onProgress = opts.onProgress;
    this.totalBytes = files.reduce((s, f) => s + f.size, 0);
  }

  async streamAll(): Promise<void> {
    let sent = 0;
    for (const file of this.files) {
      const crc = new Crc32();
      let chunkIndex = 0;
      for (let offset = 0; offset < file.size; offset += this.chunkSize) {
        if (this.channel.bufferedAmount > this.highWater) {
          await this.channel.waitForDrain(this.lowWater);
        }
        const end = Math.min(offset + this.chunkSize, file.size);
        const chunk = await file.slice(offset, end);
        crc.update(chunk);
        this.channel.send(encodeDataFrame(file.fileId, chunkIndex, chunk));
        chunkIndex++;
        sent += chunk.length;
        this.onProgress?.(sent, this.totalBytes);
      }
      this.channel.send(
        encodeControlFrame({
          type: 'file-complete',
          fileId: file.fileId,
          crc32: crc.digest(),
        })
      );
    }
    this.channel.send(encodeControlFrame({ type: 'transfer-complete' }));
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/web test sender`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/sender.ts apps/web/src/core/sender.spec.ts
git commit -m "feat(web): add chunked transfer sender with backpressure"
```

---

## Task 6: 接收端 TransferReceiver（路由 + CRC 校验，TDD）

**Files:**
- Create: `apps/web/src/core/receiver.spec.ts`, `apps/web/src/core/receiver.ts`

> `TransferReceiver` 消费帧：数据帧 → `writer.writeChunk` + 累积 CRC + 进度；`file-complete` → 比对 CRC，回报每文件结果并 `closeFile`；`transfer-complete` → `writer.finish`；`cancel` → `writer.abort`。`Writer` 接口在 Task 7 的 `storage/writer.ts` 定义；本任务先在 spec 用内联 mock，实现里 `import type { Writer }`。

- [ ] **Step 1: 先建最小 `apps/web/src/core/storage/writer.ts`（仅接口，实体在 Task 7 补全）**

```ts
export interface Writer {
  writeChunk(fileId: number, chunk: Uint8Array): Promise<void> | void;
  closeFile(fileId: number): Promise<void> | void;
  finish(): Promise<void> | void;
  abort(): Promise<void> | void;
}
```

- [ ] **Step 2: 写失败测试 `apps/web/src/core/receiver.spec.ts`**

```ts
import {
  crc32,
  encodeControlFrame,
  encodeDataFrame,
} from '@peerlink/protocol';
import { describe, expect, it, vi } from 'vitest';

import { TransferReceiver } from './receiver';
import type { Writer } from './storage/writer';

function mockWriter() {
  const data = new Map<number, number[]>();
  const writer: Writer = {
    writeChunk(fileId, chunk) {
      const arr = data.get(fileId) ?? [];
      arr.push(...chunk);
      data.set(fileId, arr);
    },
    closeFile: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(),
  };
  return { writer, data };
}

const manifest = {
  type: 'manifest' as const,
  totalSize: 5,
  files: [{ fileId: 0, name: 'a.bin', size: 5, relativePath: 'a.bin' }],
};

describe('TransferReceiver', () => {
  it('reassembles chunks and verifies a matching CRC', async () => {
    const { writer, data } = mockWriter();
    const results: { fileId: number; ok: boolean }[] = [];
    const finished = vi.fn();
    const r = new TransferReceiver(manifest, writer, {
      onFileResult: (fileId, ok) => results.push({ fileId, ok }),
      onComplete: finished,
    });

    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    await r.handleFrame(encodeDataFrame(0, 0, bytes.subarray(0, 3)));
    await r.handleFrame(encodeDataFrame(0, 1, bytes.subarray(3, 5)));
    await r.handleFrame(
      encodeControlFrame({ type: 'file-complete', fileId: 0, crc32: crc32(bytes) })
    );
    await r.handleFrame(encodeControlFrame({ type: 'transfer-complete' }));

    expect(data.get(0)).toEqual([10, 20, 30, 40, 50]);
    expect(results).toEqual([{ fileId: 0, ok: true }]);
    expect(writer.finish).toHaveBeenCalled();
    expect(finished).toHaveBeenCalled();
  });

  it('flags a CRC mismatch as failed', async () => {
    const { writer } = mockWriter();
    const results: boolean[] = [];
    const r = new TransferReceiver(manifest, writer, {
      onFileResult: (_id, ok) => results.push(ok),
    });
    await r.handleFrame(encodeDataFrame(0, 0, new Uint8Array([1, 2, 3, 4, 5])));
    await r.handleFrame(
      encodeControlFrame({ type: 'file-complete', fileId: 0, crc32: 12345 })
    );
    expect(results).toEqual([false]);
  });

  it('aborts the writer on cancel', async () => {
    const { writer } = mockWriter();
    const r = new TransferReceiver(manifest, writer, {});
    await r.handleFrame(encodeControlFrame({ type: 'cancel', reason: 'x' }));
    expect(writer.abort).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `pnpm --filter @peerlink/web test receiver`
Expected: FAIL，模块未找到。

- [ ] **Step 4: 实现 `apps/web/src/core/receiver.ts`**

```ts
import {
  controlMessageSchema,
  Crc32,
  decodeFrame,
  type FileEntry,
} from '@peerlink/protocol';

import type { Writer } from './storage/writer';

export interface ReceiverManifest {
  type: 'manifest';
  files: FileEntry[];
  totalSize: number;
}

export interface TransferReceiverOptions {
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  onFileResult?: (fileId: number, ok: boolean) => void;
  onComplete?: () => void;
  onCancel?: (reason?: string) => void;
}

export class TransferReceiver {
  private crcs = new Map<number, Crc32>();
  private received = 0;

  constructor(
    private manifest: ReceiverManifest,
    private writer: Writer,
    private opts: TransferReceiverOptions
  ) {}

  async handleFrame(bytes: Uint8Array): Promise<void> {
    const frame = decodeFrame(bytes);
    if (frame.kind === 'data') {
      await this.writer.writeChunk(frame.fileId, frame.payload);
      this.crc(frame.fileId).update(frame.payload);
      this.received += frame.payload.length;
      this.opts.onProgress?.(this.received, this.manifest.totalSize);
      return;
    }
    const msg = controlMessageSchema.parse(frame.message);
    switch (msg.type) {
      case 'file-complete': {
        const ok = this.crc(msg.fileId).digest() === msg.crc32;
        await this.writer.closeFile(msg.fileId);
        this.opts.onFileResult?.(msg.fileId, ok);
        return;
      }
      case 'transfer-complete':
        await this.writer.finish();
        this.opts.onComplete?.();
        return;
      case 'cancel':
        await this.writer.abort();
        this.opts.onCancel?.(msg.reason);
        return;
    }
  }

  private crc(fileId: number): Crc32 {
    let c = this.crcs.get(fileId);
    if (!c) {
      c = new Crc32();
      this.crcs.set(fileId, c);
    }
    return c;
  }
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `pnpm --filter @peerlink/web test receiver`
Expected: PASS（3 个用例）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/core/receiver.ts apps/web/src/core/storage/writer.ts apps/web/src/core/receiver.spec.ts
git commit -m "feat(web): add transfer receiver with CRC verification"
```

---

## Task 7: Blob 写入器 + 能力探测/工厂（TDD）

**Files:**
- Modify: `apps/web/src/core/storage/writer.ts`（补全能力探测 + 工厂）
- Create: `apps/web/src/core/storage/blob-writer.spec.ts`, `blob-writer.ts`
- Create: `apps/web/src/core/storage/writer.spec.ts`

> `BlobWriter`：把每个文件的块累积为 Blob，`finish` 时通过注入的 `onFile(name, blob)` 回调交付（生产环境触发下载）。`detectCapabilities` 探测 File System Access；`createWriter` 据能力 + 是否含目录选择实现。

- [ ] **Step 1: 写失败测试 `apps/web/src/core/storage/blob-writer.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { BlobWriter } from './blob-writer';

const manifest = {
  type: 'manifest' as const,
  totalSize: 3,
  files: [{ fileId: 0, name: 'a.bin', size: 3, relativePath: 'a.bin' }],
};

describe('BlobWriter', () => {
  it('delivers the assembled blob with correct bytes on finish', async () => {
    const delivered: { name: string; bytes: number[] }[] = [];
    const w = new BlobWriter(manifest, {
      onFile: async (name, blob) => {
        delivered.push({
          name,
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        });
      },
    });
    w.writeChunk(0, new Uint8Array([7, 8]));
    w.writeChunk(0, new Uint8Array([9]));
    w.closeFile(0);
    await w.finish();
    expect(delivered).toEqual([{ name: 'a.bin', bytes: [7, 8, 9] }]);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/web test blob-writer`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/web/src/core/storage/blob-writer.ts`**

```ts
import type { FileEntry } from '@peerlink/protocol';

import type { Writer } from './writer';

interface BlobManifest {
  files: FileEntry[];
}

export interface BlobWriterOptions {
  /** 文件就绪时交付（生产环境：触发下载）。 */
  onFile: (name: string, blob: Blob) => Promise<void> | void;
}

export class BlobWriter implements Writer {
  private parts = new Map<number, BlobPart[]>();

  constructor(
    private manifest: BlobManifest,
    private opts: BlobWriterOptions
  ) {}

  writeChunk(fileId: number, chunk: Uint8Array): void {
    const arr = this.parts.get(fileId) ?? [];
    // 复制一份，避免底层缓冲被复用
    arr.push(chunk.slice());
    this.parts.set(fileId, arr);
  }

  closeFile(): void {
    /* Blob 在 finish 时统一组装 */
  }

  async finish(): Promise<void> {
    for (const entry of this.manifest.files) {
      const blob = new Blob(this.parts.get(entry.fileId) ?? []);
      await this.opts.onFile(entry.name, blob);
    }
  }

  abort(): void {
    this.parts.clear();
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/web test blob-writer`
Expected: PASS。

- [ ] **Step 5: 补全 `apps/web/src/core/storage/writer.ts`（在已有 `Writer` 接口下追加）**

```ts
import type { FileEntry } from '@peerlink/protocol';

export interface Writer {
  writeChunk(fileId: number, chunk: Uint8Array): Promise<void> | void;
  closeFile(fileId: number): Promise<void> | void;
  finish(): Promise<void> | void;
  abort(): Promise<void> | void;
}

export interface WriterCapabilities {
  fileSystemAccess: boolean;
}

export type WriterKind = 'fs-access' | 'zip' | 'blob';

/** 探测浏览器写入能力。 */
export function detectCapabilities(
  win: Pick<Window, 'showDirectoryPicker'> | typeof globalThis = globalThis
): WriterCapabilities {
  return {
    fileSystemAccess:
      typeof (win as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      'function',
  };
}

/** 根据能力与是否含目录，决定使用哪种写入器。 */
export function chooseWriterKind(
  caps: WriterCapabilities,
  opts: { fileCount: number; hasDirectory: boolean }
): WriterKind {
  if (caps.fileSystemAccess && (opts.hasDirectory || opts.fileCount > 1)) {
    return 'fs-access';
  }
  if (opts.hasDirectory || opts.fileCount > 1) return 'zip';
  return 'blob';
}

export function manifestHasDirectory(files: FileEntry[]): boolean {
  return files.some(f => f.relativePath.includes('/'));
}
```

- [ ] **Step 6: 写失败测试 `apps/web/src/core/storage/writer.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  chooseWriterKind,
  detectCapabilities,
  manifestHasDirectory,
} from './writer';

describe('detectCapabilities', () => {
  it('reports fileSystemAccess based on showDirectoryPicker', () => {
    expect(detectCapabilities({ showDirectoryPicker: () => {} } as never)).toEqual(
      { fileSystemAccess: true }
    );
    expect(detectCapabilities({} as never)).toEqual({ fileSystemAccess: false });
  });
});

describe('chooseWriterKind', () => {
  const caps = (fs: boolean) => ({ fileSystemAccess: fs });
  it('uses fs-access for folders/multi when supported', () => {
    expect(chooseWriterKind(caps(true), { fileCount: 3, hasDirectory: true })).toBe(
      'fs-access'
    );
  });
  it('falls back to zip for folders/multi without fs-access', () => {
    expect(chooseWriterKind(caps(false), { fileCount: 2, hasDirectory: false })).toBe(
      'zip'
    );
  });
  it('uses blob for a single flat file', () => {
    expect(chooseWriterKind(caps(false), { fileCount: 1, hasDirectory: false })).toBe(
      'blob'
    );
  });
});

describe('manifestHasDirectory', () => {
  it('detects nested relative paths', () => {
    expect(
      manifestHasDirectory([
        { fileId: 0, name: 'a', size: 0, relativePath: 'x/a' },
      ])
    ).toBe(true);
    expect(
      manifestHasDirectory([{ fileId: 0, name: 'a', size: 0, relativePath: 'a' }])
    ).toBe(false);
  });
});
```

- [ ] **Step 7: 运行，确认通过**

Run: `pnpm --filter @peerlink/web test writer`
Expected: PASS（blob-writer 与 writer 用例全过）。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/core/storage/blob-writer.ts apps/web/src/core/storage/blob-writer.spec.ts apps/web/src/core/storage/writer.ts apps/web/src/core/storage/writer.spec.ts
git commit -m "feat(web): add blob writer and capability-based writer selection"
```

---

## Task 8: File System Access 与 ZIP 写入器（浏览器实现）

**Files:**
- Create: `apps/web/src/core/storage/fs-access-writer.ts`
- Create: `apps/web/src/core/storage/zip-writer.ts`

> 这两者依赖浏览器 API，难以纯单测，由 Task 12 的 E2E（Chromium）与手测覆盖。给出完整实现。

- [ ] **Step 1: 实现 `apps/web/src/core/storage/fs-access-writer.ts`**

```ts
import type { FileEntry } from '@peerlink/protocol';

import type { Writer } from './writer';

interface FsManifest {
  files: FileEntry[];
}

/** 把文件按 relativePath 原样写入用户选择的目录（Chromium）。 */
export class FsAccessWriter implements Writer {
  private streams = new Map<number, FileSystemWritableFileStream>();
  private ready: Promise<void>;

  constructor(
    private manifest: FsManifest,
    private root: FileSystemDirectoryHandle
  ) {
    this.ready = this.openAll();
  }

  private async openAll(): Promise<void> {
    for (const entry of this.manifest.files) {
      const parts = entry.relativePath.split('/');
      const fileName = parts.pop()!;
      let dir = this.root;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const handle = await dir.getFileHandle(fileName, { create: true });
      this.streams.set(entry.fileId, await handle.createWritable());
    }
  }

  async writeChunk(fileId: number, chunk: Uint8Array): Promise<void> {
    await this.ready;
    await this.streams.get(fileId)?.write(chunk);
  }

  async closeFile(fileId: number): Promise<void> {
    const s = this.streams.get(fileId);
    if (s) {
      await s.close();
      this.streams.delete(fileId);
    }
  }

  async finish(): Promise<void> {
    for (const s of this.streams.values()) await s.close();
    this.streams.clear();
  }

  async abort(): Promise<void> {
    for (const s of this.streams.values()) await s.abort().catch(() => {});
    this.streams.clear();
  }
}
```

- [ ] **Step 2: 实现 `apps/web/src/core/storage/zip-writer.ts`**

```ts
import type { FileEntry } from '@peerlink/protocol';
import { BlobWriter as ZipBlobWriter, ZipWriter } from '@zip.js/zip.js';

import type { Writer } from './writer';

interface ZipManifest {
  files: FileEntry[];
}

/** 把所有文件流式打包为单个 .zip 并交付下载。 */
export class FolderZipWriter implements Writer {
  private zip = new ZipWriter(new ZipBlobWriter('application/zip'));
  private entryStreams = new Map<
    number,
    { controller: ReadableStreamDefaultController<Uint8Array>; done: Promise<unknown> }
  >();

  constructor(
    private manifest: ZipManifest,
    private onZip: (blob: Blob) => Promise<void> | void
  ) {
    for (const entry of this.manifest.files) this.openEntry(entry);
  }

  private openEntry(entry: FileEntry): void {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: c => {
        controller = c;
      },
    });
    const done = this.zip.add(entry.relativePath, stream);
    this.entryStreams.set(entry.fileId, { controller, done });
  }

  writeChunk(fileId: number, chunk: Uint8Array): void {
    this.entryStreams.get(fileId)?.controller.enqueue(chunk);
  }

  closeFile(fileId: number): void {
    this.entryStreams.get(fileId)?.controller.close();
  }

  async finish(): Promise<void> {
    await Promise.all([...this.entryStreams.values()].map(e => e.done));
    const blob = await this.zip.close();
    await this.onZip(blob);
  }

  async abort(): Promise<void> {
    await this.zip.close().catch(() => {});
  }
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS。（如 `FileSystemDirectoryHandle` 等类型缺失，确认 tsconfig `lib` 含 `DOM`；这些类型属 DOM lib。）

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/core/storage/fs-access-writer.ts apps/web/src/core/storage/zip-writer.ts
git commit -m "feat(web): add file-system-access and zip writers"
```

---

## Task 9: PeerConnection 封装（注入 pc 工厂，TDD）

**Files:**
- Create: `apps/web/src/core/peer-connection.spec.ts`, `apps/web/src/core/peer-connection.ts`

> 封装 `RTCPeerConnection`：发起方建 DataChannel + offer，应答方监听 `ondatachannel`，ICE 候选经回调上送。`createPc` 工厂可注入，便于断言 ICE 配置被正确传入。

- [ ] **Step 1: 写失败测试 `apps/web/src/core/peer-connection.spec.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

import { PeerConnection } from './peer-connection';

function fakePc() {
  return {
    createDataChannel: vi.fn(() => ({
      binaryType: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'X' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'Y' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    close: vi.fn(),
    addEventListener: vi.fn(),
  };
}

describe('PeerConnection', () => {
  it('passes ICE servers into the underlying RTCPeerConnection', () => {
    const ice = [{ urls: 'stun:x:1' }];
    let received: RTCConfiguration | undefined;
    new PeerConnection({
      iceServers: ice,
      createPc: cfg => {
        received = cfg;
        return fakePc() as unknown as RTCPeerConnection;
      },
    });
    expect(received?.iceServers).toBe(ice);
  });

  it('initiator creates a data channel and an offer', async () => {
    const pc = fakePc();
    const conn = new PeerConnection({
      iceServers: [],
      createPc: () => pc as unknown as RTCPeerConnection,
    });
    await conn.startAsInitiator();
    expect(pc.createDataChannel).toHaveBeenCalled();
    expect(pc.createOffer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/web test peer-connection`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/web/src/core/peer-connection.ts`**

```ts
import { DATA_CHANNEL_LABEL } from '@peerlink/protocol';

export interface PeerConnectionOptions {
  iceServers: RTCIceServer[];
  createPc?: (config: RTCConfiguration) => RTCPeerConnection;
  onChannelOpen?: (dc: RTCDataChannel) => void;
  onMessage?: (data: Uint8Array) => void;
  onSignal?: (payload: { sdp?: string; candidate?: RTCIceCandidateInit }) => void;
  onStateChange?: (state: RTCIceConnectionState) => void;
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private dc?: RTCDataChannel;

  constructor(private opts: PeerConnectionOptions) {
    const create =
      opts.createPc ?? (cfg => new RTCPeerConnection(cfg));
    this.pc = create({ iceServers: opts.iceServers });

    this.pc.addEventListener('icecandidate', evt => {
      const e = evt as RTCPeerConnectionIceEvent;
      if (e.candidate) {
        opts.onSignal?.({ candidate: e.candidate.toJSON() });
      }
    });
    this.pc.addEventListener('iceconnectionstatechange', () => {
      opts.onStateChange?.(this.pc.iceConnectionState);
    });
    this.pc.addEventListener('datachannel', evt => {
      this.bindChannel((evt as RTCDataChannelEvent).channel);
    });
  }

  async startAsInitiator(): Promise<void> {
    this.bindChannel(this.pc.createDataChannel(DATA_CHANNEL_LABEL));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.opts.onSignal?.({ sdp: offer.sdp });
  }

  async acceptOffer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.opts.onSignal?.({ sdp: answer.sdp });
  }

  async acceptAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  async addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.pc.addIceCandidate(candidate);
  }

  get channel(): RTCDataChannel | undefined {
    return this.dc;
  }

  close(): void {
    this.dc?.close();
    this.pc.close();
  }

  private bindChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.addEventListener('open', () => this.opts.onChannelOpen?.(dc));
    dc.addEventListener('message', evt => {
      const data = (evt as MessageEvent).data as ArrayBuffer;
      this.opts.onMessage?.(new Uint8Array(data));
    });
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/web test peer-connection`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/peer-connection.ts apps/web/src/core/peer-connection.spec.ts
git commit -m "feat(web): add RTCPeerConnection wrapper"
```

---

## Task 10: 应用状态 store（zustand）

**Files:**
- Create: `apps/web/src/state/store.spec.ts`, `apps/web/src/state/store.ts`

> 持有连接阶段、角色、房间码、传输进度等。纯状态转换可单测；副作用（建连/传输）由 UI 层在 Task 11 编排时调用 action。

- [ ] **Step 1: 写失败测试 `apps/web/src/state/store.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { useTransferStore } from './store';

describe('useTransferStore', () => {
  it('starts idle', () => {
    expect(useTransferStore.getState().phase).toBe('idle');
  });

  it('setRoom moves to waiting and records the roomId', () => {
    useTransferStore.getState().reset();
    useTransferStore.getState().setRoom('8423-河马');
    const s = useTransferStore.getState();
    expect(s.phase).toBe('waiting');
    expect(s.roomId).toBe('8423-河马');
  });

  it('updateProgress clamps and stores received/total', () => {
    useTransferStore.getState().reset();
    useTransferStore.getState().updateProgress(50, 100);
    expect(useTransferStore.getState().progress).toEqual({
      received: 50,
      total: 100,
    });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/web test store`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/web/src/state/store.ts`**

```ts
import { create } from 'zustand';

import type { FileEntry } from '@peerlink/protocol';

export type Phase =
  | 'idle'
  | 'waiting' // 已建房，等对端
  | 'connecting' // WebRTC 协商中
  | 'awaiting-accept' // 收到 manifest，等用户接受
  | 'transferring'
  | 'done'
  | 'error';

export type Role = 'sender' | 'receiver' | null;

interface Progress {
  received: number;
  total: number;
}

interface TransferState {
  phase: Phase;
  role: Role;
  roomId: string | null;
  manifest: FileEntry[] | null;
  progress: Progress;
  errorMessage: string | null;
  setRole(role: Role): void;
  setRoom(roomId: string): void;
  setPhase(phase: Phase): void;
  setManifest(files: FileEntry[]): void;
  updateProgress(received: number, total: number): void;
  fail(message: string): void;
  reset(): void;
}

const initial = {
  phase: 'idle' as Phase,
  role: null as Role,
  roomId: null as string | null,
  manifest: null as FileEntry[] | null,
  progress: { received: 0, total: 0 } as Progress,
  errorMessage: null as string | null,
};

export const useTransferStore = create<TransferState>(set => ({
  ...initial,
  setRole: role => set({ role }),
  setRoom: roomId => set({ roomId, phase: 'waiting' }),
  setPhase: phase => set({ phase }),
  setManifest: manifest => set({ manifest, phase: 'awaiting-accept' }),
  updateProgress: (received, total) => set({ progress: { received, total } }),
  fail: message => set({ phase: 'error', errorMessage: message }),
  reset: () => set({ ...initial }),
}));
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/web test store`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/state/store.ts apps/web/src/state/store.spec.ts
git commit -m "feat(web): add zustand transfer store"
```

---

## Task 11: UI 编排（路由 + 发送/接收）

**Files:**
- Create: `apps/web/src/lib/transfer-session.ts`（编排 signaling + peer-connection + sender/receiver）
- Create: `apps/web/src/routes/__root.tsx`, `index.tsx`, `r.$roomId.tsx`
- Create: `apps/web/src/features/send/SendPanel.tsx`, `features/receive/ReceivePanel.tsx`
- Create: `apps/web/src/features/share/RoomShare.tsx`, `features/common/Progress.tsx`
- Replace: `apps/web/src/main.tsx`

> UI 由 E2E（Task 12）覆盖，本任务给出完整实现，逐文件写入后做整体 typecheck/lint/build。`transfer-session.ts` 把 Task 2–10 的部件接到一起。

- [ ] **Step 1: 实现编排层 `apps/web/src/lib/transfer-session.ts`**

```ts
import { type FileEntry } from '@peerlink/protocol';

import { rtcSendChannel } from '@/core/channel';
import { PeerConnection } from '@/core/peer-connection';
import { TransferReceiver } from '@/core/receiver';
import {
  browserFileToSource,
  buildManifest,
  TransferSender,
} from '@/core/sender';
import { BlobWriter } from '@/core/storage/blob-writer';
import { FolderZipWriter } from '@/core/storage/zip-writer';
import { FsAccessWriter } from '@/core/storage/fs-access-writer';
import {
  chooseWriterKind,
  detectCapabilities,
  manifestHasDirectory,
  type Writer,
} from '@/core/storage/writer';
import { SignalingClient } from '@/core/signaling-client';
import { iceServersFromEnv } from '@/lib/ice-config';

function signalUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const path = import.meta.env.VITE_SIGNAL_PATH ?? '/signal';
  return `${proto}://${location.host}${path}`;
}

function triggerDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface SessionCallbacks {
  onPhase: (p: 'connecting' | 'transferring' | 'done' | 'error') => void;
  onManifest?: (files: FileEntry[]) => void;
  onProgress?: (received: number, total: number) => void;
  onRoom?: (roomId: string) => void;
  onError?: (msg: string) => void;
}

/** 发送会话：建房 → 等对端 → 发 manifest → 收到 accept 后流式发送。 */
export function startSendSession(files: File[], cb: SessionCallbacks) {
  const sig = new SignalingClient(signalUrl());
  const sources = files.map((f, i) => browserFileToSource(f, i));
  const manifest = buildManifest(sources);
  let peer: PeerConnection | undefined;
  let targetPeerId: string | undefined;

  const send = (payload: object) => targetPeerId && sig.signal(targetPeerId, payload);

  sig.on('open', () => sig.createRoom());
  sig.on('room-created', roomId => cb.onRoom?.(roomId));
  sig.on('error', (_c, m) => cb.onError?.(m));
  sig.on('peer-joined', async peerId => {
    targetPeerId = peerId;
    cb.onPhase('connecting');
    peer = new PeerConnection({
      iceServers: iceServersFromEnv(),
      onSignal: send,
      onChannelOpen: dc => {
        // 通道打开后立即发送 manifest（控制帧）
        void import('@peerlink/protocol').then(({ encodeControlFrame }) => {
          dc.send(encodeControlFrame(manifest));
        });
      },
      onMessage: async bytes => {
        const { decodeFrame, controlMessageSchema } = await import(
          '@peerlink/protocol'
        );
        const frame = decodeFrame(bytes);
        if (frame.kind !== 'control') return;
        const msg = controlMessageSchema.parse(frame.message);
        if (msg.type === 'reject') return cb.onError?.('对方已拒绝');
        if (msg.type === 'accept' && peer?.channel) {
          cb.onPhase('transferring');
          const sender = new TransferSender(
            rtcSendChannel(peer.channel),
            sources,
            { onProgress: cb.onProgress }
          );
          await sender.streamAll();
          cb.onPhase('done');
        }
      },
    });
    await peer.startAsInitiator();
  });
  sig.on('signal', async (_from, payload) => {
    const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
    if (p.sdp) await peer?.acceptAnswer(p.sdp);
    else if (p.candidate) await peer?.addCandidate(p.candidate);
  });

  return {
    cancel() {
      peer?.close();
      sig.close();
    },
  };
}

function makeWriter(files: FileEntry[]): Promise<Writer> {
  const caps = detectCapabilities();
  const hasDirectory = manifestHasDirectory(files);
  const kind = chooseWriterKind(caps, { fileCount: files.length, hasDirectory });
  if (kind === 'fs-access') {
    return window
      .showDirectoryPicker()
      .then(root => new FsAccessWriter({ files }, root));
  }
  if (kind === 'zip') {
    return Promise.resolve(
      new FolderZipWriter({ files }, blob => triggerDownload('peerlink.zip', blob))
    );
  }
  return Promise.resolve(
    new BlobWriter({ files }, (name, blob) => triggerDownload(name, blob))
  );
}

/** 接收会话：进房 → 应答 offer → 收 manifest → 用户接受后接收。 */
export function startReceiveSession(roomId: string, cb: SessionCallbacks) {
  const sig = new SignalingClient(signalUrl());
  let peer: PeerConnection | undefined;
  let fromPeerId: string | undefined;
  let receiver: TransferReceiver | undefined;
  let manifestFiles: FileEntry[] | undefined;

  sig.on('open', () => sig.joinRoom(roomId));
  sig.on('error', (_c, m) => cb.onError?.(m));
  sig.on('signal', async (from, payload) => {
    fromPeerId = from;
    const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
    if (!peer) {
      cb.onPhase('connecting');
      peer = new PeerConnection({
        iceServers: iceServersFromEnv(),
        onSignal: out => fromPeerId && sig.signal(fromPeerId, out),
        onMessage: async bytes => {
          const { decodeFrame, controlMessageSchema } = await import(
            '@peerlink/protocol'
          );
          if (!receiver) {
            const frame = decodeFrame(bytes);
            if (frame.kind === 'control') {
              const msg = controlMessageSchema.parse(frame.message);
              if (msg.type === 'manifest') {
                manifestFiles = msg.files;
                cb.onManifest?.(msg.files);
              }
            }
            return;
          }
          await receiver.handleFrame(bytes);
        },
      });
    }
    if (p.sdp) await peer.acceptOffer(p.sdp);
    else if (p.candidate) await peer.addCandidate(p.candidate);
  });

  return {
    async accept() {
      const { encodeControlFrame } = await import('@peerlink/protocol');
      if (!peer?.channel || !manifestFiles) return;
      const writer = await makeWriter(manifestFiles);
      const total = manifestFiles.reduce((s, f) => s + f.size, 0);
      receiver = new TransferReceiver(
        { type: 'manifest', files: manifestFiles, totalSize: total },
        writer,
        {
          onProgress: cb.onProgress,
          onComplete: () => cb.onPhase('done'),
        }
      );
      cb.onPhase('transferring');
      peer.channel.send(encodeControlFrame({ type: 'accept' }));
    },
    reject() {
      void import('@peerlink/protocol').then(({ encodeControlFrame }) => {
        peer?.channel?.send(encodeControlFrame({ type: 'reject' }));
        peer?.close();
        sig.close();
      });
    },
    cancel() {
      peer?.close();
      sig.close();
    },
  };
}
```

- [ ] **Step 2: 实现 `apps/web/src/features/common/Progress.tsx`**

```tsx
import { cn } from '@/lib/cn';

export function Progress({ received, total }: { received: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <div className="w-full">
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={cn('h-full rounded-full bg-blue-500 transition-all')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-gray-600" data-testid="progress-text">
        {pct}%
      </p>
    </div>
  );
}
```

- [ ] **Step 3: 实现 `apps/web/src/features/share/RoomShare.tsx`**

```tsx
import { useEffect, useState } from 'react';

import QRCode from 'qrcode';

export function RoomShare({ roomId }: { roomId: string }) {
  const [qr, setQr] = useState('');
  const link = `${location.origin}/r/${encodeURIComponent(roomId)}`;
  useEffect(() => {
    void QRCode.toDataURL(link).then(setQr);
  }, [link]);
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-gray-600">把链接、二维码或口令发给对方：</p>
      {qr && <img src={qr} alt="二维码" className="size-40" />}
      <code
        className="rounded bg-gray-100 px-3 py-1 text-lg font-semibold"
        data-testid="room-code"
      >
        {roomId}
      </code>
      <a className="break-all text-sm text-blue-600 underline" href={link}>
        {link}
      </a>
    </div>
  );
}
```

- [ ] **Step 4: 实现 `apps/web/src/features/send/SendPanel.tsx`**

```tsx
import { type ChangeEvent, useRef, useState } from 'react';

import { toast } from 'sonner';

import { Progress } from '@/features/common/Progress';
import { RoomShare } from '@/features/share/RoomShare';
import { startSendSession } from '@/lib/transfer-session';
import { useTransferStore } from '@/state/store';

export function SendPanel() {
  const store = useTransferStore();
  const sessionRef = useRef<{ cancel(): void } | null>(null);
  const [picked, setPicked] = useState<File[]>([]);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    setPicked(Array.from(e.target.files ?? []));
  }

  function start() {
    if (!picked.length) return;
    store.setRole('sender');
    sessionRef.current = startSendSession(picked, {
      onRoom: roomId => store.setRoom(roomId),
      onPhase: p => store.setPhase(p),
      onProgress: (r, t) => store.updateProgress(r, t),
      onError: m => {
        store.fail(m);
        toast.error(m);
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {store.phase === 'idle' && (
        <>
          <input
            type="file"
            multiple
            onChange={onPick}
            data-testid="file-input"
          />
          {/* 文件夹选择：webkitdirectory 需运行时设置 */}
          <input
            type="file"
            multiple
            ref={el => el && el.setAttribute('webkitdirectory', '')}
            onChange={onPick}
            data-testid="folder-input"
          />
          <button
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            disabled={!picked.length}
            onClick={start}
            data-testid="start-send"
          >
            生成分享（{picked.length} 个文件）
          </button>
        </>
      )}
      {store.phase === 'waiting' && store.roomId && (
        <RoomShare roomId={store.roomId} />
      )}
      {(store.phase === 'transferring' || store.phase === 'done') && (
        <>
          <Progress received={store.progress.received} total={store.progress.total} />
          {store.phase === 'done' && (
            <p data-testid="send-done" className="text-green-600">
              传输完成
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 实现 `apps/web/src/features/receive/ReceivePanel.tsx`**

```tsx
import { useEffect, useRef } from 'react';

import { toast } from 'sonner';

import { Progress } from '@/features/common/Progress';
import { startReceiveSession } from '@/lib/transfer-session';
import { useTransferStore } from '@/state/store';

export function ReceivePanel({ roomId }: { roomId: string }) {
  const store = useTransferStore();
  const sessionRef = useRef<ReturnType<typeof startReceiveSession> | null>(null);

  useEffect(() => {
    store.setRole('receiver');
    sessionRef.current = startReceiveSession(roomId, {
      onManifest: files => store.setManifest(files),
      onPhase: p => store.setPhase(p),
      onProgress: (r, t) => store.updateProgress(r, t),
      onError: m => {
        store.fail(m);
        toast.error(m);
      },
    });
    return () => sessionRef.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  return (
    <div className="flex flex-col gap-4">
      {store.phase === 'awaiting-accept' && store.manifest && (
        <>
          <ul className="text-sm" data-testid="manifest">
            {store.manifest.map(f => (
              <li key={f.fileId}>
                {f.relativePath} · {f.size} B
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              className="rounded bg-green-600 px-4 py-2 text-white"
              onClick={() => sessionRef.current?.accept()}
              data-testid="accept"
            >
              接受
            </button>
            <button
              className="rounded bg-gray-300 px-4 py-2"
              onClick={() => sessionRef.current?.reject()}
              data-testid="reject"
            >
              拒绝
            </button>
          </div>
        </>
      )}
      {(store.phase === 'transferring' || store.phase === 'done') && (
        <>
          <Progress received={store.progress.received} total={store.progress.total} />
          {store.phase === 'done' && (
            <p data-testid="receive-done" className="text-green-600">
              接收完成
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 实现路由 `apps/web/src/routes/__root.tsx`**

```tsx
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';

export const Route = createRootRoute({
  component: () => (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-6 text-2xl font-bold">PeerLink</h1>
      <Outlet />
      <Toaster />
    </div>
  ),
});
```

- [ ] **Step 7: 实现路由 `apps/web/src/routes/index.tsx` 与 `r.$roomId.tsx`**

`apps/web/src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';

import { SendPanel } from '@/features/send/SendPanel';

export const Route = createFileRoute('/')({
  component: SendPanel,
});
```

`apps/web/src/routes/r.$roomId.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';

import { ReceivePanel } from '@/features/receive/ReceivePanel';

export const Route = createFileRoute('/r/$roomId')({
  component: function ReceiveRoute() {
    const { roomId } = Route.useParams();
    return <ReceivePanel roomId={decodeURIComponent(roomId)} />;
  },
});
```

- [ ] **Step 8: 替换 `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createRouter, RouterProvider } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

import './index.css';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
```

- [ ] **Step 9: 整体校验**

Run:
```bash
pnpm --filter @peerlink/web typecheck
pnpm --filter @peerlink/web lint
pnpm --filter @peerlink/web build
```
Expected: 全部 PASS（首次会生成 `src/routeTree.gen.ts`；若 lint 报该生成文件，已在 eslint ignores 中）。

- [ ] **Step 10: 提交**

```bash
git add apps/web/src/lib/transfer-session.ts apps/web/src/features apps/web/src/routes apps/web/src/main.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): wire UI, routing and transfer session orchestration"
```

---

## Task 12: 端到端测试（Playwright，真实 WebRTC）

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/transfer.spec.ts`

> 双浏览器上下文跑 `localhost` 真实 WebRTC（环回无需 TURN）。`webServer` 同时拉起信令服务与 Vite 预览。单文件走 Blob 写入器，用 Playwright 下载事件捕获并比对字节；另测拒绝与取消。

- [ ] **Step 1: 安装 Playwright 浏览器**

Run: `pnpm --filter @peerlink/web exec playwright install chromium`
Expected: Chromium 下载成功。

- [ ] **Step 2: 创建 `apps/web/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: [
    {
      command: 'pnpm --filter @peerlink/signaling dev',
      url: 'http://localhost:3001/signal',
      reuseExistingServer: !process.env.CI,
      // signaling 对 GET /signal 返回 426/400 也算"起来了"
      ignoreHTTPSErrors: true,
    },
    {
      command:
        'pnpm --filter @peerlink/web exec vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
```

> 注：`vite preview` 不代理 `/signal`。E2E 用绝对地址连接信令——在 Step 4 中通过 `addInitScript` 注入 `VITE_SIGNAL_PATH` 不适用（preview 已打包）。改为：preview 阶段让页面用 `ws://localhost:3001/signal`。为此在 `signalUrl()` 中支持 `VITE_SIGNAL_URL` 覆盖，并在 build E2E 时设置。见 Step 3。

- [ ] **Step 3: 让 `signalUrl()` 支持绝对地址覆盖（修改 `apps/web/src/lib/transfer-session.ts`）**

把 `signalUrl()` 改为：

```ts
function signalUrl(): string {
  if (import.meta.env.VITE_SIGNAL_URL) return import.meta.env.VITE_SIGNAL_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const path = import.meta.env.VITE_SIGNAL_PATH ?? '/signal';
  return `${proto}://${location.host}${path}`;
}
```

并在 `apps/web/src/vite-env.d.ts` 的 `ImportMetaEnv` 中追加：

```ts
  readonly VITE_SIGNAL_URL?: string;
```

构建 E2E 预览产物时用环境变量注入：在 `playwright.config.ts` 的 web `webServer` command 前加构建步骤，或将 preview command 改为：

```ts
      command:
        'VITE_SIGNAL_URL=ws://localhost:3001/signal pnpm --filter @peerlink/web build && pnpm --filter @peerlink/web exec vite preview --port 4173 --strictPort',
```

- [ ] **Step 4: 创建 `apps/web/e2e/transfer.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

test('sends a single file peer-to-peer and the receiver downloads identical bytes', async ({
  browser,
}) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext();
  const sPage = await sender.newPage();
  const rPage = await receiver.newPage();

  await sPage.goto('/');

  // 选择一个内容已知的文件
  const content = 'hello-peerlink-'.repeat(1000);
  await sPage.setInputFiles('[data-testid=file-input]', {
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });
  await sPage.click('[data-testid=start-send]');

  const code = await sPage.locator('[data-testid=room-code]').textContent();
  expect(code).toBeTruthy();

  await rPage.goto(`/r/${encodeURIComponent(code!.trim())}`);
  await rPage.waitForSelector('[data-testid=manifest]');

  const downloadPromise = rPage.waitForEvent('download');
  await rPage.click('[data-testid=accept]');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).toString()).toBe(content);

  await sPage.waitForSelector('[data-testid=send-done]');
  await sender.close();
  await receiver.close();
});

test('receiver can reject a transfer', async ({ browser }) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext();
  const sPage = await sender.newPage();
  const rPage = await receiver.newPage();

  await sPage.goto('/');
  await sPage.setInputFiles('[data-testid=file-input]', {
    name: 'x.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('abc'),
  });
  await sPage.click('[data-testid=start-send]');
  const code = (await sPage.locator('[data-testid=room-code]').textContent())!.trim();

  await rPage.goto(`/r/${encodeURIComponent(code)}`);
  await rPage.waitForSelector('[data-testid=manifest]');
  await rPage.click('[data-testid=reject]');

  // 发送端应收到拒绝提示（sonner toast 文本）
  await expect(sPage.getByText('对方已拒绝')).toBeVisible();
  await sender.close();
  await receiver.close();
});
```

- [ ] **Step 5: 运行 E2E**

Run: `pnpm --filter @peerlink/web e2e`
Expected: 两个用例 PASS。若首个用例因 WebRTC 协商慢偶发超时，可将 `timeout` 调高或在等待 manifest 后加显式等待。

- [ ] **Step 6: 提交**

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/web/src/lib/transfer-session.ts apps/web/src/vite-env.d.ts
git commit -m "test(web): add Playwright e2e for p2p transfer, reject"
```

---

## Task 13: 接入容器化开发环境

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: 在 `docker-compose.yml` 的 `# ─── 计划 3 加入 web 服务 ───` 处加入 web 服务**

```yaml
  web:
    <<: *app-build
    restart: unless-stopped
    depends_on:
      deps:
        condition: service_completed_successfully
      signaling:
        condition: service_started
    environment:
      RUNNING_IN_DOCKER: '1'
      TRAEFIK_PORT: ${TRAEFIK_PORT:-8894}
    command: pnpm --filter @peerlink/web dev
    volumes:
      - ./:/workspace
    networks:
      - internal
    labels:
      - traefik.enable=true
      - traefik.docker.network=peerlink_internal
      - traefik.http.routers.pl-web.rule=PathPrefix(`/`)
      - traefik.http.routers.pl-web.entrypoints=web
      - traefik.http.routers.pl-web.priority=1
      - traefik.http.services.pl-web.loadbalancer.server.port=5173
```

- [ ] **Step 2: 端到端容器冒烟**

Run:
```bash
docker compose up -d
sleep 8
curl -s -o /dev/null -w "%{http_code}" http://localhost:8894/
```
Expected: 返回 200（Vite 首页）。浏览器开两个标签：`http://localhost:8894/`（发送）与生成的 `/r/<code>`（接收），手动验证传一个文件成功。随后 `docker compose down`。

- [ ] **Step 3: 提交**

```bash
git add docker-compose.yml
git commit -m "chore: add web service to dev compose with / route"
```

---

## 计划完成后（阶段一交付）

- 浏览器间可经局域网或链接/二维码/口令配对，P2P 传输多文件/文件夹/大文件。
- 核心逻辑有单测，端到端有 Playwright 验证，整套可在容器内 `docker compose up` 跑起。
- 后续阶段（App / 小程序 / 自建 TURN）按各自独立 spec 推进。

---

## 自查（写完即查）

**Spec 覆盖:**
- 2.3 客户端分层（signaling-client/peer-connection/transfer(sender+receiver)/storage/ui）→ Task 3/9/5/6/7-8/11 ✔
- 2.4 容器化 web 服务 + Traefik `/` → Task 13 ✔
- 4.1 流程（manifest→accept/reject→数据→file-complete→transfer-complete）→ Task 5/6/11 ✔
- 4.2 分片帧（复用 protocol 编解码）→ Task 5/6 ✔
- 4.3 背压（high/low watermark + waitForDrain）→ Task 4/5 ✔
- 4.4 写入抽象三实现 + 能力探测/自动选择 → Task 7/8 ✔
- 4.5 CRC32 校验 → Task 6 ✔
- 4.6 进度与取消 → Task 5/6（onProgress、cancel/abort）+ Task 11（cancel）✔
- 4 可插拔 TURN → Task 2 ✔
- 5.1 ICE 失败提示 → Task 9（onStateChange，UI 可据此提示）；5.2 拒绝/取消 → Task 6/11/12 ✔
- 6.3 各层单测 + mock → Task 2/3/5/6/7/9/10 ✔
- 6.4 E2E（单文件/拒绝；多文件/文件夹/取消为后续可加用例）→ Task 12 ✔

**Placeholder 扫描:** 无 TBD/TODO；每个代码步骤含完整代码。Task 12 Step 3 明确给出对 `signalUrl()` 的具体改法，非占位。

**类型一致性:** `SendChannel`（Task4）被 `TransferSender`/`rtcSendChannel` 一致使用；`Writer`（Task6 建接口、Task7 补全）被 receiver 与三个写入器一致实现；`SignalingClient` 事件名（room-created/peer-joined/peer-left/lan-peers/signal/error）与 protocol `ServerMessage` 对齐；`PeerConnection`（startAsInitiator/acceptOffer/acceptAnswer/addCandidate/channel）在 transfer-session 中一致调用；store 的 `Phase`/`updateProgress`/`setManifest` 与 UI 一致。
