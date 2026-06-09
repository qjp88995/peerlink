# PeerLink 基建 + @peerlink/protocol 实现计划（计划 1 / 3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭出对齐 smart-property 工程范式的容器化 pnpm/turbo monorepo，并实现带完整单测的 `@peerlink/protocol` 协议包（信令消息 zod schema + 文件分片帧编解码 + CRC32）。

**Architecture:** pnpm workspace（`apps/*` + `packages/*`）+ Turborepo 编排，全 ESM，Node ≥22。`@peerlink/protocol` 是前端与信令服务的唯一协议事实源：用 zod 定义并校验所有消息，用定长二进制帧承载文件数据块，用 CRC32 做完整性校验。开发全程在 Docker 容器内（Traefik 反代，端口 8894/8895）。

**Tech Stack:** pnpm@10、Turborepo、TypeScript（strict/ESM/bundler）、zod、Vitest、ESLint（flat config）、Prettier、Husky + lint-staged、Docker Compose + Traefik。

**关联文档:** 设计 spec → `docs/superpowers/specs/2026-06-08-peerlink-web-design.md`（尤其第 2.5 工程约定、第 3.3 信令协议、第 4.2 分片协议、第 4.5 校验）。

**本计划范围:** 仅基建 + `@peerlink/protocol`。`@peerlink/signaling` 见计划 2，`@peerlink/web` 见计划 3。

---

## 文件结构（本计划创建/修改）

```
peerlink/
├── package.json                      # 根 workspace + turbo 脚本           [Task 1]
├── pnpm-workspace.yaml               # workspace + catalog 版本声明         [Task 1]
├── .npmrc                            # npmmirror 镜像                       [Task 1]
├── .gitignore                                                              [Task 1]
├── tsconfig.base.json                # 共享 TS 基础配置                     [Task 1]
├── eslint.config.base.mjs            # 共享 ESLint 基础配置                 [Task 2]
├── .prettierrc / .prettierignore                                          [Task 2]
├── turbo.json                                                             [Task 2]
├── .husky/pre-commit                 # lint-staged 钩子                     [Task 8]
├── docker/Dockerfile.dev             # 共享开发镜像                         [Task 7]
├── docker-compose.yml                # deps + traefik + (web/signaling 占位) [Task 7]
├── docker-compose.override.yml       # 暴露 Traefik 端口 8894/8895          [Task 7]
├── .env.example                                                           [Task 7]
├── .github/workflows/ci.yml          # lint/typecheck/test                  [Task 8]
└── packages/protocol/
    ├── package.json                                                       [Task 3]
    ├── tsconfig.json / tsconfig.build.json                                [Task 3]
    ├── eslint.config.mjs                                                  [Task 3]
    ├── vitest.config.ts                                                   [Task 3]
    └── src/
        ├── index.ts                  # 统一 re-export                      [Task 3,4,5,6,7-frame...]
        ├── constants.ts              # 块大小/水位/TTL 等常量               [Task 4]
        ├── crc32.ts + crc32.spec.ts  # CRC32 增量校验                       [Task 5]
        ├── signaling.ts + .spec.ts   # 信令消息 zod schema                  [Task 6]
        ├── control.ts + .spec.ts     # DataChannel 控制消息 zod schema      [Task 6]
        └── frame.ts + frame.spec.ts  # 二进制帧编解码                       [Task 9]
```

---

## Task 1: 根 workspace 配置

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`
- Create: `.gitignore`
- Create: `tsconfig.base.json`

> 说明：本目录已是 git 仓库（含 spec/plan 提交）。本任务只新增上述根配置文件。

- [ ] **Step 1: 创建 `.npmrc`**

```
registry=https://registry.npmmirror.com/
```

- [ ] **Step 2: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
.turbo/
*.tsbuildinfo
.env
.DS_Store
*.log
playwright-report/
test-results/
```

- [ ] **Step 3: 创建 `pnpm-workspace.yaml`（含 catalog 版本声明）**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

onlyBuiltDependencies:
  - esbuild
  - '@tailwindcss/oxide'

catalog:
  # ─── Runtime ───
  zod: '^4.4.1'
  ws: '^8.18.0'
  pino: '^10.3.1'
  pino-pretty: '^13.1.3'

  # ─── Frontend ───
  react: '^19.2.5'
  react-dom: '^19.2.5'
  '@tanstack/react-router': '^1.168.26'
  '@tanstack/router-plugin': '^1.167.29'
  zustand: '^5.0.12'
  sonner: '^2.0.7'
  lucide-react: '^1.14.0'
  clsx: '^2.1.1'
  tailwind-merge: '^3.5.0'
  qrcode: '^1.5.4'
  '@zip.js/zip.js': '^2.7.52'

  # ─── Build / Vite ───
  vite: '^8.0.10'
  '@vitejs/plugin-react': '^6.0.1'
  '@tailwindcss/vite': '^4.2.4'
  tailwindcss: '^4.2.4'

  # ─── Lint / Format ───
  '@eslint/js': '^10.0.1'
  eslint: '^10.2.1'
  eslint-plugin-react-hooks: '^7.1.1'
  eslint-plugin-react-refresh: '^0.5.2'
  eslint-plugin-simple-import-sort: '^13.0.0'
  globals: '^17.5.0'
  prettier: '^3.8.3'
  typescript: '^5.9.3'
  typescript-eslint: '^8.59.1'

  # ─── Types ───
  '@types/node': '^25.6.0'
  '@types/react': '^19.2.0'
  '@types/react-dom': '^19.2.0'
  '@types/ws': '^8.5.13'
  '@types/qrcode': '^1.5.5'

  # ─── Test ───
  vitest: '^4.1.5'
  '@playwright/test': '^1.49.0'
```

- [ ] **Step 4: 创建根 `package.json`**

```json
{
  "name": "peerlink",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "format": "prettier --write \"{apps,packages}/**/*.{ts,tsx,css,json,md}\"",
    "format:check": "prettier --check \"{apps,packages}/**/*.{ts,tsx,css,json,md}\"",
    "prepare": "husky"
  },
  "devDependencies": {
    "@eslint/js": "catalog:",
    "eslint": "catalog:",
    "eslint-plugin-simple-import-sort": "catalog:",
    "globals": "catalog:",
    "husky": "^9.1.7",
    "lint-staged": "^16.4.0",
    "prettier": "catalog:",
    "turbo": "^2.9.6",
    "typescript": "catalog:",
    "typescript-eslint": "catalog:"
  },
  "lint-staged": {
    "packages/protocol/**/*.ts": [
      "prettier --write",
      "eslint --fix -c packages/protocol/eslint.config.mjs"
    ],
    "*.{json,md,css,yml,yaml}": [
      "prettier --write"
    ]
  },
  "packageManager": "pnpm@10.33.2",
  "engines": {
    "node": ">=22.0.0"
  }
}
```

- [ ] **Step 5: 创建 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true
  }
}
```

- [ ] **Step 6: 提交**

```bash
git add .npmrc .gitignore pnpm-workspace.yaml package.json tsconfig.base.json
git commit -m "chore: scaffold pnpm workspace root config"
```

---

## Task 2: 共享 Lint / Format / Turbo 配置

**Files:**
- Create: `eslint.config.base.mjs`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `turbo.json`

- [ ] **Step 1: 创建 `eslint.config.base.mjs`**

```js
import js from '@eslint/js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Shared base config used by every package's eslint.config.{mjs,js}.
 * Each package extends this and adds its own globals / framework plugins.
 */
export const baseConfig = defineConfig({
  extends: [js.configs.recommended, ...tseslint.configs.recommended],
  plugins: {
    'simple-import-sort': simpleImportSort,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'simple-import-sort/exports': 'error',
  },
});
```

- [ ] **Step 2: 创建 `.prettierrc`**

```json
{
  "singleQuote": true,
  "jsxSingleQuote": false,
  "semi": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 80,
  "bracketSpacing": true,
  "arrowParens": "avoid",
  "endOfLine": "lf"
}
```

- [ ] **Step 3: 创建 `.prettierignore`**

```
dist
node_modules
.turbo
pnpm-lock.yaml
```

- [ ] **Step 4: 创建 `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add eslint.config.base.mjs .prettierrc .prettierignore turbo.json
git commit -m "chore: add shared eslint/prettier/turbo config"
```

---

## Task 3: 搭出 `@peerlink/protocol` 包骨架

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/tsconfig.build.json`
- Create: `packages/protocol/eslint.config.mjs`
- Create: `packages/protocol/vitest.config.ts`
- Create: `packages/protocol/src/index.ts`

- [ ] **Step 1: 创建 `packages/protocol/package.json`**

```json
{
  "name": "@peerlink/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "rm -f *.tsbuildinfo && tsc -p tsconfig.build.json",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist .turbo *.tsbuildinfo"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "@eslint/js": "catalog:",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "eslint-plugin-simple-import-sort": "catalog:",
    "globals": "catalog:",
    "typescript": "catalog:",
    "typescript-eslint": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: 创建 `packages/protocol/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 `packages/protocol/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true
  },
  "exclude": ["**/*.spec.ts"]
}
```

- [ ] **Step 4: 创建 `packages/protocol/eslint.config.mjs`**

```js
import globals from 'globals';
import { defineConfig } from 'eslint/config';

import { baseConfig } from '../../eslint.config.base.mjs';

export default defineConfig(
  { ignores: ['dist'] },
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      'simple-import-sort/imports': 'error',
    },
  }
);
```

- [ ] **Step 5: 创建 `packages/protocol/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
```

- [ ] **Step 6: 创建占位 `packages/protocol/src/index.ts`**

```ts
export {};
```

- [ ] **Step 7: 安装依赖（首次）**

Run: `pnpm install`
Expected: 安装成功，生成 `pnpm-lock.yaml`，`packages/protocol/node_modules` 出现。

- [ ] **Step 8: 验证脚本可跑**

Run: `pnpm --filter @peerlink/protocol test`
Expected: Vitest 报 "No test files found"（此时尚无测试），命令本身退出码为 0 或提示无测试——不报配置错误即可。

- [ ] **Step 9: 提交**

```bash
git add packages/protocol pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "chore: scaffold @peerlink/protocol package"
```

---

## Task 4: 协议常量

**Files:**
- Create: `packages/protocol/src/constants.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: 创建 `packages/protocol/src/constants.ts`**

```ts
/** 默认数据块大小（字节）。16 KB 跨浏览器最安全。 */
export const DEFAULT_CHUNK_SIZE = 16 * 1024;

/** 探测到更大 maxMessageSize 时可提升到的上限（字节）。 */
export const MAX_CHUNK_SIZE = 64 * 1024;

/** 发送端缓冲高水位：超过则暂停发送（字节）。 */
export const BUFFER_HIGH_WATERMARK = 1024 * 1024;

/** 发送端缓冲低水位：降到此值以下恢复发送（字节）。 */
export const BUFFER_LOW_WATERMARK = 256 * 1024;

/** 房间无人加入的存活时间（毫秒）。 */
export const ROOM_TTL_MS = 10 * 60 * 1000;

/** DataChannel 标签名。 */
export const DATA_CHANNEL_LABEL = 'peerlink-transfer';
```

- [ ] **Step 2: 在 `packages/protocol/src/index.ts` 导出**

```ts
export * from './constants';
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @peerlink/protocol typecheck`
Expected: PASS（无类型错误）。

- [ ] **Step 4: 提交**

```bash
git add packages/protocol/src/constants.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add shared constants"
```

---

## Task 5: CRC32 增量校验（TDD）

**Files:**
- Create: `packages/protocol/src/crc32.spec.ts`
- Create: `packages/protocol/src/crc32.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: 写失败测试 `packages/protocol/src/crc32.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { Crc32, crc32 } from './crc32';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the standard test vector for "123456789"', () => {
    // 标准 CRC-32 (IEEE 802.3) 校验值
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  it('returns 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('produces an unsigned 32-bit integer', () => {
    const v = crc32(bytes('hello world'));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('Crc32 (incremental)', () => {
  it('chained updates equal a single-shot call', () => {
    const full = crc32(bytes('123456789'));
    const c = new Crc32();
    c.update(bytes('1234'));
    c.update(bytes('56789'));
    expect(c.digest()).toBe(full);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @peerlink/protocol test`
Expected: FAIL，报 `Cannot find module './crc32'` 或导出不存在。

- [ ] **Step 3: 实现 `packages/protocol/src/crc32.ts`**

```ts
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** 可增量更新的 CRC-32（IEEE 802.3）计算器。 */
export class Crc32 {
  private crc = 0xffffffff;

  update(data: Uint8Array): this {
    let crc = this.crc;
    for (let i = 0; i < data.length; i++) {
      crc = (CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    this.crc = crc;
    return this;
  }

  digest(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }
}

/** 一次性计算整段数据的 CRC-32。 */
export function crc32(data: Uint8Array): number {
  return new Crc32().update(data).digest();
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @peerlink/protocol test`
Expected: PASS（4 个用例全过）。

- [ ] **Step 5: 在 `index.ts` 导出**

```ts
export * from './constants';
export * from './crc32';
```

- [ ] **Step 6: 提交**

```bash
git add packages/protocol/src/crc32.ts packages/protocol/src/crc32.spec.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add incremental CRC32"
```

---

## Task 6: 信令消息 + 控制消息 zod schema（TDD）

**Files:**
- Create: `packages/protocol/src/signaling.spec.ts`
- Create: `packages/protocol/src/signaling.ts`
- Create: `packages/protocol/src/control.spec.ts`
- Create: `packages/protocol/src/control.ts`
- Modify: `packages/protocol/src/index.ts`

> 信令消息走 WebSocket（客户端↔信令服务）；控制消息走 DataChannel（浏览器↔浏览器）。两者分文件。

### 6a. 信令消息

- [ ] **Step 1: 写失败测试 `packages/protocol/src/signaling.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  clientMessageSchema,
  serverMessageSchema,
} from './signaling';

describe('clientMessageSchema', () => {
  it('accepts create-room', () => {
    expect(clientMessageSchema.parse({ type: 'create-room' })).toEqual({
      type: 'create-room',
    });
  });

  it('accepts join-room with roomId', () => {
    const msg = { type: 'join-room', roomId: '8423-河马' };
    expect(clientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts a signal message carrying an opaque payload', () => {
    const msg = {
      type: 'signal',
      to: 'peer-2',
      payload: { sdp: 'v=0...' },
    };
    expect(clientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('rejects an unknown type', () => {
    expect(() => clientMessageSchema.parse({ type: 'nope' })).toThrow();
  });
});

describe('serverMessageSchema', () => {
  it('accepts room-created', () => {
    const msg = { type: 'room-created', roomId: '8423-河马' };
    expect(serverMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts lan-peers list', () => {
    const msg = {
      type: 'lan-peers',
      peers: [{ peerId: 'p1', name: '橙色河马' }],
    };
    expect(serverMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts error with code', () => {
    const msg = { type: 'error', code: 'ROOM_NOT_FOUND', message: '房间不存在' };
    expect(serverMessageSchema.parse(msg)).toEqual(msg);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/protocol test signaling`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `packages/protocol/src/signaling.ts`**

```ts
import { z } from 'zod';

/** 信令服务可返回的错误码。 */
export const signalErrorCode = z.enum([
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_EXPIRED',
  'BAD_MESSAGE',
  'RATE_LIMITED',
]);
export type SignalErrorCode = z.infer<typeof signalErrorCode>;

/** WebRTC 信令载荷：服务不解析内容，原样透传。 */
export const signalPayloadSchema = z.union([
  z.object({ sdp: z.string() }),
  z.object({ candidate: z.unknown() }),
]);

// ─── 客户端 → 服务 ───
const createRoom = z.object({ type: z.literal('create-room') });
const joinRoom = z.object({ type: z.literal('join-room'), roomId: z.string() });
const lanInvite = z.object({
  type: z.literal('lan-invite'),
  targetPeerId: z.string(),
});
const clientSignal = z.object({
  type: z.literal('signal'),
  to: z.string(),
  payload: signalPayloadSchema,
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  createRoom,
  joinRoom,
  lanInvite,
  clientSignal,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ─── 服务 → 客户端 ───
const roomCreated = z.object({
  type: z.literal('room-created'),
  roomId: z.string(),
});
const peerJoined = z.object({
  type: z.literal('peer-joined'),
  peerId: z.string(),
});
const peerLeft = z.object({ type: z.literal('peer-left'), peerId: z.string() });
const lanPeer = z.object({ peerId: z.string(), name: z.string() });
const lanPeers = z.object({
  type: z.literal('lan-peers'),
  peers: z.array(lanPeer),
});
const serverSignal = z.object({
  type: z.literal('signal'),
  from: z.string(),
  payload: signalPayloadSchema,
});
const errorMsg = z.object({
  type: z.literal('error'),
  code: signalErrorCode,
  message: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  roomCreated,
  peerJoined,
  peerLeft,
  lanPeers,
  serverSignal,
  errorMsg,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type LanPeer = z.infer<typeof lanPeer>;
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/protocol test signaling`
Expected: PASS。

### 6b. 控制消息（DataChannel）

- [ ] **Step 5: 写失败测试 `packages/protocol/src/control.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { controlMessageSchema } from './control';

describe('controlMessageSchema', () => {
  it('accepts a manifest with file entries', () => {
    const msg = {
      type: 'manifest',
      totalSize: 2048,
      files: [
        { fileId: 0, name: 'a.jpg', size: 1024, relativePath: 'photos/a.jpg' },
        { fileId: 1, name: 'b.txt', size: 1024, relativePath: 'b.txt' },
      ],
    };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts accept / reject', () => {
    expect(controlMessageSchema.parse({ type: 'accept' })).toEqual({
      type: 'accept',
    });
    expect(controlMessageSchema.parse({ type: 'reject' })).toEqual({
      type: 'reject',
    });
  });

  it('accepts file-complete with crc32', () => {
    const msg = { type: 'file-complete', fileId: 0, crc32: 0xcbf43926 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts transfer-complete and cancel', () => {
    expect(controlMessageSchema.parse({ type: 'transfer-complete' })).toEqual({
      type: 'transfer-complete',
    });
    expect(
      controlMessageSchema.parse({ type: 'cancel', reason: 'user' })
    ).toEqual({ type: 'cancel', reason: 'user' });
  });

  it('rejects negative file size', () => {
    expect(() =>
      controlMessageSchema.parse({
        type: 'manifest',
        totalSize: -1,
        files: [],
      })
    ).toThrow();
  });
});
```

- [ ] **Step 6: 运行，确认失败**

Run: `pnpm --filter @peerlink/protocol test control`
Expected: FAIL，模块未找到。

- [ ] **Step 7: 实现 `packages/protocol/src/control.ts`**

```ts
import { z } from 'zod';

/** manifest 中的单个文件条目。 */
export const fileEntrySchema = z.object({
  fileId: z.number().int().nonnegative(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  /** 相对路径（含目录），单文件时等于文件名。 */
  relativePath: z.string(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

const manifest = z.object({
  type: z.literal('manifest'),
  files: z.array(fileEntrySchema),
  totalSize: z.number().int().nonnegative(),
});
const accept = z.object({ type: z.literal('accept') });
const reject = z.object({ type: z.literal('reject') });
const fileComplete = z.object({
  type: z.literal('file-complete'),
  fileId: z.number().int().nonnegative(),
  crc32: z.number().int().nonnegative(),
});
const transferComplete = z.object({ type: z.literal('transfer-complete') });
const cancel = z.object({
  type: z.literal('cancel'),
  reason: z.string().optional(),
});

export const controlMessageSchema = z.discriminatedUnion('type', [
  manifest,
  accept,
  reject,
  fileComplete,
  transferComplete,
  cancel,
]);
export type ControlMessage = z.infer<typeof controlMessageSchema>;
```

- [ ] **Step 8: 运行，确认通过**

Run: `pnpm --filter @peerlink/protocol test control`
Expected: PASS。

- [ ] **Step 9: 在 `index.ts` 导出**

```ts
export * from './constants';
export * from './control';
export * from './crc32';
export * from './signaling';
```

- [ ] **Step 10: 提交**

```bash
git add packages/protocol/src/signaling.ts packages/protocol/src/signaling.spec.ts packages/protocol/src/control.ts packages/protocol/src/control.spec.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add signaling and control message schemas"
```

---

## Task 7: 二进制帧编解码（TDD）

**Files:**
- Create: `packages/protocol/src/frame.spec.ts`
- Create: `packages/protocol/src/frame.ts`
- Modify: `packages/protocol/src/index.ts`

> 帧格式（见 spec 4.2）：首字节为帧类型。控制帧 = `[0x00][UTF-8 JSON]`；数据帧 = `[0x01][fileId:uint32 BE][chunkIndex:uint32 BE][payload]`。

- [ ] **Step 1: 写失败测试 `packages/protocol/src/frame.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  decodeFrame,
  encodeControlFrame,
  encodeDataFrame,
} from './frame';

describe('control frame', () => {
  it('round-trips a JSON control message', () => {
    const msg = { type: 'accept' };
    const frame = encodeControlFrame(msg);
    const decoded = decodeFrame(frame);
    expect(decoded.kind).toBe('control');
    if (decoded.kind === 'control') {
      expect(decoded.message).toEqual(msg);
    }
  });
});

describe('data frame', () => {
  it('round-trips fileId, chunkIndex and payload', () => {
    const payload = new Uint8Array([1, 2, 3, 250, 255]);
    const frame = encodeDataFrame(7, 42, payload);
    const decoded = decodeFrame(frame);
    expect(decoded.kind).toBe('data');
    if (decoded.kind === 'data') {
      expect(decoded.fileId).toBe(7);
      expect(decoded.chunkIndex).toBe(42);
      expect(Array.from(decoded.payload)).toEqual([1, 2, 3, 250, 255]);
    }
  });

  it('handles large 32-bit chunk indices', () => {
    const frame = encodeDataFrame(0, 4_000_000_000, new Uint8Array([9]));
    const decoded = decodeFrame(frame);
    if (decoded.kind === 'data') {
      expect(decoded.chunkIndex).toBe(4_000_000_000);
    } else {
      throw new Error('expected data frame');
    }
  });
});

describe('decodeFrame', () => {
  it('throws on unknown frame tag', () => {
    expect(() => decodeFrame(new Uint8Array([0xff, 0, 0]))).toThrow();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/protocol test frame`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `packages/protocol/src/frame.ts`**

```ts
export const FRAME_CONTROL = 0x00;
export const FRAME_DATA = 0x01;

const DATA_HEADER_BYTES = 1 + 4 + 4; // tag + fileId + chunkIndex

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 编码控制帧：`[0x00][UTF-8 JSON]`。 */
export function encodeControlFrame(message: unknown): Uint8Array {
  const json = encoder.encode(JSON.stringify(message));
  const out = new Uint8Array(1 + json.length);
  out[0] = FRAME_CONTROL;
  out.set(json, 1);
  return out;
}

/** 编码数据帧：`[0x01][fileId BE][chunkIndex BE][payload]`。 */
export function encodeDataFrame(
  fileId: number,
  chunkIndex: number,
  payload: Uint8Array
): Uint8Array {
  const out = new Uint8Array(DATA_HEADER_BYTES + payload.length);
  const view = new DataView(out.buffer);
  out[0] = FRAME_DATA;
  view.setUint32(1, fileId, false);
  view.setUint32(5, chunkIndex, false);
  out.set(payload, DATA_HEADER_BYTES);
  return out;
}

export type DecodedFrame =
  | { kind: 'control'; message: unknown }
  | {
      kind: 'data';
      fileId: number;
      chunkIndex: number;
      payload: Uint8Array;
    };

/** 解码任意帧。未知首字节抛错。 */
export function decodeFrame(bytes: Uint8Array): DecodedFrame {
  const tag = bytes[0];
  if (tag === FRAME_CONTROL) {
    const message = JSON.parse(decoder.decode(bytes.subarray(1)));
    return { kind: 'control', message };
  }
  if (tag === FRAME_DATA) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fileId = view.getUint32(1, false);
    const chunkIndex = view.getUint32(5, false);
    const payload = bytes.subarray(DATA_HEADER_BYTES);
    return { kind: 'data', fileId, chunkIndex, payload };
  }
  throw new Error(`Unknown frame tag: ${tag}`);
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/protocol test frame`
Expected: PASS。

- [ ] **Step 5: 在 `index.ts` 导出（最终形态）**

```ts
export * from './constants';
export * from './control';
export * from './crc32';
export * from './frame';
export * from './signaling';
```

- [ ] **Step 6: 全量校验（测试 + 类型 + lint + 构建）**

Run:
```bash
pnpm --filter @peerlink/protocol test
pnpm --filter @peerlink/protocol typecheck
pnpm --filter @peerlink/protocol lint
pnpm --filter @peerlink/protocol build
```
Expected: 全部 PASS；`packages/protocol/dist/` 生成 `.js` 与 `.d.ts`。

- [ ] **Step 7: 提交**

```bash
git add packages/protocol/src/frame.ts packages/protocol/src/frame.spec.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add binary frame codec"
```

---

## Task 8: 容器化开发环境

**Files:**
- Create: `docker/Dockerfile.dev`
- Create: `docker-compose.yml`
- Create: `docker-compose.override.yml`
- Create: `.env.example`

> 本计划只起得来 `deps` + `traefik`；`web` / `signaling` 服务定义在计划 2/3 加入。为避免引用未创建的服务，本任务的 compose 仅含 `deps` 与 `traefik`，并在注释中预留 app 服务位置。

- [ ] **Step 1: 创建 `docker/Dockerfile.dev`**

```dockerfile
# 共享开发镜像：所有 app 服务复用。源码 bind-mount，依赖装在挂载目录。
FROM node:24-bookworm-slim

ARG UID=1000
ARG GID=1000

# 用宿主 UID/GID 创建用户，避免 bind-mount 文件权限问题。
RUN groupmod -g "${GID}" node 2>/dev/null || true; \
    usermod -u "${UID}" -g "${GID}" node 2>/dev/null || true

RUN corepack enable

WORKDIR /workspace
USER node

# 实际命令由 compose 的 command 指定（pnpm install / pnpm --filter ... dev）。
CMD ["bash"]
```

- [ ] **Step 2: 创建 `docker-compose.yml`**

```yaml
# ─────────────────────────────────────────────────────────────
# 本地开发 compose。所有 app 跑在容器内，Traefik 统一反代。
# 宿主只暴露 Traefik 端口（见 docker-compose.override.yml）。
#
# 路由（计划 2/3 接入 app 服务后生效）：
#   http://localhost:${TRAEFIK_PORT}/        → web:5173 (Vite)
#   http://localhost:${TRAEFIK_PORT}/signal  → signaling (WebSocket)
#
# 生产部署不在此文件范围。
# ─────────────────────────────────────────────────────────────

x-app-build: &app-build
  build:
    context: .
    dockerfile: docker/Dockerfile.dev
    args:
      UID: ${UID:-1000}
      GID: ${GID:-1000}
  image: peerlink-dev:latest

services:
  # 一次性安装依赖；app 服务启动前完成。
  deps:
    <<: *app-build
    command: pnpm install
    volumes:
      - ./:/workspace
    networks:
      - internal

  traefik:
    image: traefik:latest
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=peerlink_internal
      - --entrypoints.web.address=:80
      - --api.insecure=true
      - --api.dashboard=true
      - --log.level=INFO
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - internal
    # 宿主端口映射在 docker-compose.override.yml。

  # ─── 计划 2 加入 signaling 服务 ───
  # ─── 计划 3 加入 web 服务 ───

networks:
  internal:
    name: peerlink_internal
    driver: bridge
```

- [ ] **Step 3: 创建 `docker-compose.override.yml`**

```yaml
# 仅把 Traefik 端口暴露到宿主。端口须避开已有项目：
# smart-property=8888/8889, stock-trading=8890/8891, agent-x=8892/8893。
# PeerLink 用 8894/8895。
services:
  traefik:
    ports:
      - '${TRAEFIK_PORT:-8894}:80'
      - '${TRAEFIK_DASHBOARD_PORT:-8895}:8080'
```

- [ ] **Step 4: 创建 `.env.example`**

```bash
# Traefik 对外端口（避开 8888-8893）
TRAEFIK_PORT=8894
TRAEFIK_DASHBOARD_PORT=8895

# 宿主用户（Linux 下建议设为 `id -u` / `id -g` 以对齐 bind-mount 权限）
UID=1000
GID=1000

# WebRTC ICE 服务器（前端用；逗号分隔多个 STUN）
VITE_STUN_URLS=stun:stun.l.google.com:19302
# 可选 TURN（留空则仅用 STUN）
VITE_TURN_URL=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

- [ ] **Step 5: 验证 deps + traefik 起得来**

Run:
```bash
cp .env.example .env
docker compose up deps
```
Expected: `deps` 服务运行 `pnpm install` 后以退出码 0 结束（`service_completed_successfully`）。

Run: `docker compose up -d traefik && curl -s -o /dev/null -w "%{http_code}" http://localhost:8895/`
Expected: Traefik dashboard 返回 200（或 302）。随后 `docker compose down`。

- [ ] **Step 6: 提交**

```bash
git add docker/Dockerfile.dev docker-compose.yml docker-compose.override.yml .env.example
git commit -m "chore: add containerized dev environment (traefik on 8894/8895)"
```

---

## Task 9: Husky + lint-staged + CI

**Files:**
- Create: `.husky/pre-commit`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 初始化 husky**

Run: `pnpm exec husky init`
Expected: 生成 `.husky/` 目录与 `.husky/pre-commit`，根 `package.json` 已含 `"prepare": "husky"`（Task 1 已写）。

- [ ] **Step 2: 写入 `.husky/pre-commit`**

```sh
pnpm exec lint-staged
```

- [ ] **Step 3: 创建 `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 4: 验证 lint-staged 钩子可触发**

Run:
```bash
printf 'export const ping = 1\n' > packages/protocol/src/_probe.ts
git add packages/protocol/src/_probe.ts
git commit -m "test: probe lint-staged"
```
Expected: 提交时 lint-staged 运行 prettier/eslint（会把缺失的分号补上）。随后清理：

```bash
git rm -f packages/protocol/src/_probe.ts
git commit -m "test: remove probe"
```

- [ ] **Step 5: 验证全仓 turbo 流水线**

Run:
```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```
Expected: 全部 PASS（目前仅 `@peerlink/protocol` 有实质任务）。

- [ ] **Step 6: 提交**

```bash
git add .husky .github
git commit -m "chore: add husky pre-commit hook and CI workflow"
```

---

## 计划完成后

- `@peerlink/protocol` 已实现并通过全部单测（CRC32、信令/控制 schema、帧编解码）。
- monorepo 可在容器内开发，`turbo` 流水线绿。
- **下一步:** 计划 2 实现 `@peerlink/signaling`（ws 服务、房间状态机、局域网分组、短口令生成），计划 3 实现 `@peerlink/web`。

---

## 自查（写完即查）

**Spec 覆盖:**
- 第 2.5 工程约定（pnpm/catalog/turbo/eslint/prettier/husky/tsconfig/vitest/zod/CI）→ Task 1,2,3,9 ✔
- 第 2.4 容器化开发（Dockerfile.dev/compose/override/Traefik 8894-8895/网络名）→ Task 8 ✔
- 第 3.3 信令消息协议 → Task 6a（signaling.ts）✔
- 第 4.2 分片帧格式 → Task 7（frame.ts）✔
- 第 4.5 CRC32 校验 → Task 5 ✔
- 控制消息（manifest/accept/reject/file-complete/transfer-complete/cancel）→ Task 6b ✔
- 常量（块大小/水位/TTL）→ Task 4 ✔
- 短口令格式：roomId 在信令消息中为字符串 schema（生成器属信令服务职责，计划 2）— 本计划仅接纳字符串，无遗漏。

**Placeholder 扫描:** 无 TBD/TODO；每个代码步骤含完整代码。

**类型一致性:** `Crc32`/`crc32`（Task5）、`clientMessageSchema`/`serverMessageSchema`（Task6a）、`controlMessageSchema`/`fileEntrySchema`（Task6b）、`encodeControlFrame`/`encodeDataFrame`/`decodeFrame`/`DecodedFrame`（Task7）在 index.ts 导出名一致；常量名（`DEFAULT_CHUNK_SIZE` 等）跨任务一致。
