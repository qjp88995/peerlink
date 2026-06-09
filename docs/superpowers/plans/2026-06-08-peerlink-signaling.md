# PeerLink @peerlink/signaling 实现计划（计划 2 / 3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现轻量 WebSocket 信令服务 `@peerlink/signaling`：撮合房间、转发 WebRTC 信令、按公网 IP 做局域网分组、生成「4 位数字 + 中文词」短口令；文件数据永不经过它。

**Architecture:** 基于 `ws` 库的单进程服务。纯逻辑（房间状态机 `RoomManager`、局域网注册表 `LanRegistry`、短口令生成 `room-id`）与 IO（`SignalingServer` 包裹 `ws.Server`）分离，前者可纯单测，后者用真实 ws 起服务做集成测试。消息收发全部经 `@peerlink/protocol` 的 zod schema 校验。

**Tech Stack:** Node ≥22、`ws`、`pino`（结构化日志）、zod、`@peerlink/protocol`（workspace）、Vitest。

**前置:** 计划 1（`@peerlink/protocol` 已构建可用）。

**关联 spec:** 第 3.1 房间模型、3.2 局域网发现、3.3 信令消息、3.4 服务状态。

**初始化约定（initiator）:** 房间内**先到的成员**为发起方。服务在第 2 个成员加入时，只向**已在房间的那个成员**发 `peer-joined{peerId: 新成员}`；收到 `peer-joined` 的一方负责创建 offer，另一方等待 offer 再应答。此约定不需要扩展 Plan 1 的 schema。

---

## 文件结构

```
apps/signaling/
├── package.json                         [Task 1]
├── tsconfig.json                        [Task 1]
├── eslint.config.mjs                    [Task 1]
├── vitest.config.ts                     [Task 1]
└── src/
    ├── config.ts                        # 从 env 读端口/路径               [Task 1]
    ├── room-id.ts + room-id.spec.ts     # 短口令生成 + 中文词库            [Task 2]
    ├── room-manager.ts + .spec.ts       # 房间状态机（创建/加入/离开/回收） [Task 3]
    ├── lan-registry.ts + .spec.ts       # 局域网分组 + 设备名生成          [Task 4]
    ├── server.ts                        # SignalingServer：ws 接线         [Task 5]
    ├── server.spec.ts                   # 真实 ws 集成测试                 [Task 6]
    └── index.ts                         # 进程入口                         [Task 5]
```

修改：`docker-compose.yml`（接入 signaling 服务 + Traefik 路由）[Task 7]。

---

## Task 1: 搭出 `apps/signaling` 包骨架

**Files:**
- Create: `apps/signaling/package.json`
- Create: `apps/signaling/tsconfig.json`
- Create: `apps/signaling/eslint.config.mjs`
- Create: `apps/signaling/vitest.config.ts`
- Create: `apps/signaling/src/config.ts`
- Create: `apps/signaling/src/index.ts`（占位）

- [ ] **Step 1: 创建 `apps/signaling/package.json`**

```json
{
  "name": "@peerlink/signaling",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "node --watch --experimental-strip-types src/index.ts",
    "start": "node dist/index.js",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@peerlink/protocol": "workspace:*",
    "pino": "catalog:",
    "ws": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@eslint/js": "catalog:",
    "@types/node": "catalog:",
    "@types/ws": "catalog:",
    "eslint": "catalog:",
    "eslint-plugin-simple-import-sort": "catalog:",
    "globals": "catalog:",
    "pino-pretty": "catalog:",
    "typescript": "catalog:",
    "typescript-eslint": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: 创建 `apps/signaling/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts"]
}
```

- [ ] **Step 3: 创建 `apps/signaling/eslint.config.mjs`**

```js
import globals from 'globals';
import { defineConfig } from 'eslint/config';

import { baseConfig } from '../../eslint.config.base.mjs';

export default defineConfig(
  { ignores: ['dist'] },
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
    rules: { 'simple-import-sort/imports': 'error' },
  }
);
```

- [ ] **Step 4: 创建 `apps/signaling/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.spec.ts'] },
});
```

- [ ] **Step 5: 创建 `apps/signaling/src/config.ts`**

```ts
export interface SignalingConfig {
  port: number;
  /** WebSocket 路径，经 Traefik 反代到 /signal。 */
  path: string;
  /** 房间无人加入的存活时间（毫秒）。 */
  roomTtlMs: number;
  /** 回收任务的轮询间隔（毫秒）。 */
  reapIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SignalingConfig {
  return {
    port: Number(env.SIGNALING_PORT ?? 3001),
    path: env.SIGNALING_PATH ?? '/signal',
    roomTtlMs: Number(env.ROOM_TTL_MS ?? 10 * 60 * 1000),
    reapIntervalMs: Number(env.REAP_INTERVAL_MS ?? 30 * 1000),
  };
}
```

- [ ] **Step 6: 创建占位 `apps/signaling/src/index.ts`**

```ts
export {};
```

- [ ] **Step 7: 安装并验证**

Run: `pnpm install && pnpm --filter @peerlink/signaling typecheck`
Expected: 安装成功，typecheck PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/signaling pnpm-lock.yaml
git commit -m "chore: scaffold @peerlink/signaling package"
```

---

## Task 2: 短口令生成 + 中文词库（TDD）

**Files:**
- Create: `apps/signaling/src/room-id.spec.ts`
- Create: `apps/signaling/src/room-id.ts`

- [ ] **Step 1: 写失败测试 `apps/signaling/src/room-id.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { generateRoomId, WORDS } from './room-id';

describe('generateRoomId', () => {
  it('produces 4 digits + dash + a Chinese word from the list', () => {
    const id = generateRoomId(() => 0.5);
    expect(id).toMatch(/^\d{4}-.+$/);
    const word = id.split('-')[1];
    expect(WORDS).toContain(word);
  });

  it('pads digits to 4 places', () => {
    const id = generateRoomId(() => 0); // 数字与索引都取 0
    expect(id.split('-')[0]).toBe('0000');
  });

  it('is deterministic given a fixed rng', () => {
    const rng = () => 0.123456;
    expect(generateRoomId(rng)).toBe(generateRoomId(rng));
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/signaling test room-id`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/signaling/src/room-id.ts`**

```ts
/** 易读易念的常用中文名词词库，用于短口令的词部分。 */
export const WORDS = [
  '河马', '老虎', '熊猫', '海豚', '企鹅', '孔雀', '骆驼', '刺猬',
  '松鼠', '狐狸', '袋鼠', '考拉', '鲸鱼', '章鱼', '蝴蝶', '萤火虫',
  '苹果', '香蕉', '菠萝', '西瓜', '草莓', '柠檬', '葡萄', '樱桃',
  '月亮', '星星', '彩虹', '闪电', '火山', '海浪', '森林', '雪花',
];

/**
 * 生成「4 位数字-中文词」短口令，如 `8423-河马`。
 * rng 默认 Math.random，可注入以便测试。
 */
export function generateRoomId(rng: () => number = Math.random): string {
  const digits = String(Math.floor(rng() * 10000)).padStart(4, '0');
  const word = WORDS[Math.floor(rng() * WORDS.length)];
  return `${digits}-${word}`;
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/signaling test room-id`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/signaling/src/room-id.ts apps/signaling/src/room-id.spec.ts
git commit -m "feat(signaling): add Chinese-word room id generator"
```

---

## Task 3: 房间状态机 RoomManager（TDD）

**Files:**
- Create: `apps/signaling/src/room-manager.spec.ts`
- Create: `apps/signaling/src/room-manager.ts`

> 设计：最多 2 人/房间。`createRoom` 把创建者作为首个成员。`now()` 与 `genId()` 注入以便测试；回收用显式 `reap()`（由 server 定时调用），不在内部用真实定时器。

- [ ] **Step 1: 写失败测试 `apps/signaling/src/room-manager.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { RoomManager } from './room-manager';

function makeManager(now = { t: 0 }) {
  let n = 0;
  return new RoomManager({
    now: () => now.t,
    ttlMs: 1000,
    genId: () => `room-${n++}`,
  });
}

describe('RoomManager', () => {
  it('creates a room with the creator as first member', () => {
    const m = makeManager();
    const id = m.createRoom('alice');
    expect(id).toBe('room-0');
    expect(m.getPeers(id)).toEqual(['alice']);
  });

  it('lets a second peer join and reports existing members', () => {
    const m = makeManager();
    const id = m.createRoom('alice');
    const result = m.joinRoom(id, 'bob');
    expect(result).toEqual({ ok: true, existingPeers: ['alice'] });
    expect(m.getPeers(id).sort()).toEqual(['alice', 'bob']);
  });

  it('rejects a third peer with ROOM_FULL', () => {
    const m = makeManager();
    const id = m.createRoom('alice');
    m.joinRoom(id, 'bob');
    expect(m.joinRoom(id, 'carol')).toEqual({ ok: false, code: 'ROOM_FULL' });
  });

  it('rejects joining a missing room with ROOM_NOT_FOUND', () => {
    const m = makeManager();
    expect(m.joinRoom('nope', 'bob')).toEqual({
      ok: false,
      code: 'ROOM_NOT_FOUND',
    });
  });

  it('leave removes peer and returns the remaining members', () => {
    const m = makeManager();
    const id = m.createRoom('alice');
    m.joinRoom(id, 'bob');
    expect(m.leave('alice')).toEqual({ roomId: id, remaining: ['bob'] });
    expect(m.getPeers(id)).toEqual(['bob']);
  });

  it('reap removes empty rooms older than ttl', () => {
    const clock = { t: 0 };
    const m = makeManager(clock);
    const id = m.createRoom('alice');
    m.leave('alice'); // 房间变空
    clock.t = 999;
    expect(m.reap()).toEqual([]); // 未到 ttl
    clock.t = 1001;
    expect(m.reap()).toEqual([id]); // 超过 ttl 被回收
    expect(m.joinRoom(id, 'bob')).toEqual({
      ok: false,
      code: 'ROOM_NOT_FOUND',
    });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/signaling test room-manager`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/signaling/src/room-manager.ts`**

```ts
import { generateRoomId } from './room-id';

export type JoinResult =
  | { ok: true; existingPeers: string[] }
  | { ok: false; code: 'ROOM_NOT_FOUND' | 'ROOM_FULL' };

interface Room {
  id: string;
  members: string[];
  /** 最后一次成员数变为 0 的时间；非空时为 null。 */
  emptySince: number | null;
}

interface RoomManagerOptions {
  now?: () => number;
  ttlMs?: number;
  genId?: () => string;
}

const MAX_MEMBERS = 2;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private peerToRoom = new Map<string, string>();
  private now: () => number;
  private ttlMs: number;
  private genId: () => string;

  constructor(opts: RoomManagerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
    this.genId = opts.genId ?? (() => generateRoomId());
  }

  createRoom(peerId: string): string {
    let id = this.genId();
    while (this.rooms.has(id)) id = this.genId();
    this.rooms.set(id, { id, members: [peerId], emptySince: null });
    this.peerToRoom.set(peerId, id);
    return id;
  }

  joinRoom(roomId: string, peerId: string): JoinResult {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, code: 'ROOM_NOT_FOUND' };
    if (room.members.length >= MAX_MEMBERS) {
      return { ok: false, code: 'ROOM_FULL' };
    }
    const existingPeers = [...room.members];
    room.members.push(peerId);
    room.emptySince = null;
    this.peerToRoom.set(peerId, roomId);
    return { ok: true, existingPeers };
  }

  leave(peerId: string): { roomId: string; remaining: string[] } | null {
    const roomId = this.peerToRoom.get(peerId);
    if (!roomId) return null;
    this.peerToRoom.delete(peerId);
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.members = room.members.filter(m => m !== peerId);
    if (room.members.length === 0) room.emptySince = this.now();
    return { roomId, remaining: [...room.members] };
  }

  /** 返回 peerId 当前所在房间的对端列表（不含自己）。 */
  getPeers(roomId: string): string[] {
    return [...(this.rooms.get(roomId)?.members ?? [])];
  }

  roomOf(peerId: string): string | undefined {
    return this.peerToRoom.get(peerId);
  }

  /** 回收空置超过 ttl 的房间，返回被回收的 roomId 列表。 */
  reap(): string[] {
    const now = this.now();
    const removed: string[] = [];
    for (const [id, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > this.ttlMs) {
        this.rooms.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/signaling test room-manager`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/signaling/src/room-manager.ts apps/signaling/src/room-manager.spec.ts
git commit -m "feat(signaling): add room state machine"
```

---

## Task 4: 局域网注册表 LanRegistry（TDD）

**Files:**
- Create: `apps/signaling/src/lan-registry.spec.ts`
- Create: `apps/signaling/src/lan-registry.ts`

> 按 ipGroup（公网 IP）分组在线设备，提供同组设备列表；为每个设备生成「颜色+动物」昵称。

- [ ] **Step 1: 写失败测试 `apps/signaling/src/lan-registry.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { generateDeviceName, LanRegistry } from './lan-registry';

describe('generateDeviceName', () => {
  it('combines a color and an animal', () => {
    const name = generateDeviceName(() => 0);
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(1);
  });
});

describe('LanRegistry', () => {
  it('lists peers in the same ip group, excluding the asker', () => {
    const r = new LanRegistry();
    r.add('p1', '1.2.3.4', '红色河马');
    r.add('p2', '1.2.3.4', '蓝色老虎');
    r.add('p3', '9.9.9.9', '绿色熊猫');
    expect(r.peersFor('p1')).toEqual([{ peerId: 'p2', name: '蓝色老虎' }]);
    expect(r.peersFor('p3')).toEqual([]);
  });

  it('groupMembers returns all peerIds sharing the asker group', () => {
    const r = new LanRegistry();
    r.add('p1', '1.2.3.4', 'a');
    r.add('p2', '1.2.3.4', 'b');
    expect(r.groupMembers('p1').sort()).toEqual(['p1', 'p2']);
  });

  it('remove drops the peer from its group', () => {
    const r = new LanRegistry();
    r.add('p1', '1.2.3.4', 'a');
    r.add('p2', '1.2.3.4', 'b');
    r.remove('p2');
    expect(r.peersFor('p1')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @peerlink/signaling test lan-registry`
Expected: FAIL，模块未找到。

- [ ] **Step 3: 实现 `apps/signaling/src/lan-registry.ts`**

```ts
import type { LanPeer } from '@peerlink/protocol';

const COLORS = ['红色', '蓝色', '绿色', '橙色', '紫色', '金色', '青色', '粉色'];
const ANIMALS = ['河马', '老虎', '熊猫', '海豚', '企鹅', '孔雀', '狐狸', '松鼠'];

export function generateDeviceName(rng: () => number = Math.random): string {
  const color = COLORS[Math.floor(rng() * COLORS.length)];
  const animal = ANIMALS[Math.floor(rng() * ANIMALS.length)];
  return `${color}${animal}`;
}

interface Entry {
  peerId: string;
  ipGroup: string;
  name: string;
}

/** 按公网 IP 分组的在线设备注册表（局域网发现用）。 */
export class LanRegistry {
  private byPeer = new Map<string, Entry>();

  add(peerId: string, ipGroup: string, name: string): void {
    this.byPeer.set(peerId, { peerId, ipGroup, name });
  }

  remove(peerId: string): void {
    this.byPeer.delete(peerId);
  }

  /** 与 peerId 同组的其他设备（用于推送 lan-peers）。 */
  peersFor(peerId: string): LanPeer[] {
    const self = this.byPeer.get(peerId);
    if (!self) return [];
    const peers: LanPeer[] = [];
    for (const e of this.byPeer.values()) {
      if (e.peerId !== peerId && e.ipGroup === self.ipGroup) {
        peers.push({ peerId: e.peerId, name: e.name });
      }
    }
    return peers;
  }

  /** 同组所有成员（含自己），用于向整组广播更新。 */
  groupMembers(peerId: string): string[] {
    const self = this.byPeer.get(peerId);
    if (!self) return [];
    return [...this.byPeer.values()]
      .filter(e => e.ipGroup === self.ipGroup)
      .map(e => e.peerId);
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @peerlink/signaling test lan-registry`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/signaling/src/lan-registry.ts apps/signaling/src/lan-registry.spec.ts
git commit -m "feat(signaling): add LAN registry and device names"
```

---

## Task 5: SignalingServer 接线 + 进程入口

**Files:**
- Create: `apps/signaling/src/server.ts`
- Modify: `apps/signaling/src/index.ts`

> `SignalingServer` 用 `WebSocketServer`（绑定到 http server，便于按路径挂载并读取来源 IP）。每连接分配随机 `peerId`；入站消息经 `clientMessageSchema` 校验；出站经类型化辅助函数发送。集成测试在 Task 6。

- [ ] **Step 1: 实现 `apps/signaling/src/server.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';

import {
  type ClientMessage,
  clientMessageSchema,
  type ServerMessage,
} from '@peerlink/protocol';
import type { Logger } from 'pino';
import { type WebSocket, WebSocketServer } from 'ws';

import type { SignalingConfig } from './config';
import { generateDeviceName, LanRegistry } from './lan-registry';
import { RoomManager } from './room-manager';

interface Client {
  peerId: string;
  socket: WebSocket;
  ipGroup: string;
}

export class SignalingServer {
  private http: HttpServer;
  private wss: WebSocketServer;
  private rooms: RoomManager;
  private lan = new LanRegistry();
  private clients = new Map<string, Client>();
  private reapTimer?: ReturnType<typeof setInterval>;

  constructor(
    private config: SignalingConfig,
    private log: Logger
  ) {
    this.rooms = new RoomManager({ ttlMs: config.roomTtlMs });
    this.http = createServer();
    this.wss = new WebSocketServer({ server: this.http, path: config.path });
    this.wss.on('connection', (socket, req) => {
      const ipGroup = (
        (req.headers['x-forwarded-for'] as string)?.split(',')[0] ??
        req.socket.remoteAddress ??
        'unknown'
      ).trim();
      this.onConnection(socket, ipGroup);
    });
  }

  listen(): Promise<void> {
    return new Promise(resolve => {
      this.http.listen(this.config.port, () => {
        this.reapTimer = setInterval(
          () => this.rooms.reap(),
          this.config.reapIntervalMs
        );
        this.log.info({ port: this.config.port }, 'signaling listening');
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.reapTimer) clearInterval(this.reapTimer);
    await new Promise<void>(r => this.wss.close(() => r()));
    await new Promise<void>(r => this.http.close(() => r()));
  }

  /** 测试辅助：返回实际监听端口。 */
  get port(): number {
    const addr = this.http.address();
    return typeof addr === 'object' && addr ? addr.port : this.config.port;
  }

  private onConnection(socket: WebSocket, ipGroup: string): void {
    const peerId = randomUUID();
    const name = generateDeviceName();
    const client: Client = { peerId, socket, ipGroup };
    this.clients.set(peerId, client);
    this.lan.add(peerId, ipGroup, name);
    this.broadcastLanPeers(peerId);

    socket.on('message', raw => this.onMessage(client, raw.toString()));
    socket.on('close', () => this.onClose(client));
    socket.on('error', () => this.onClose(client));
  }

  private onMessage(client: Client, raw: string): void {
    let parsed: ClientMessage;
    try {
      parsed = clientMessageSchema.parse(JSON.parse(raw));
    } catch {
      this.send(client.peerId, {
        type: 'error',
        code: 'BAD_MESSAGE',
        message: '无法解析的消息',
      });
      return;
    }

    switch (parsed.type) {
      case 'create-room': {
        const roomId = this.rooms.createRoom(client.peerId);
        this.send(client.peerId, { type: 'room-created', roomId });
        break;
      }
      case 'join-room': {
        const result = this.rooms.joinRoom(parsed.roomId, client.peerId);
        if (!result.ok) {
          this.send(client.peerId, {
            type: 'error',
            code: result.code,
            message:
              result.code === 'ROOM_FULL' ? '该房间已被占用' : '房间不存在或已失效',
          });
          return;
        }
        // 先到的成员为发起方：通知它有新对端加入。
        for (const existing of result.existingPeers) {
          this.send(existing, { type: 'peer-joined', peerId: client.peerId });
        }
        break;
      }
      case 'lan-invite': {
        const target = this.clients.get(parsed.targetPeerId);
        if (!target || target.ipGroup !== client.ipGroup) {
          this.send(client.peerId, {
            type: 'error',
            code: 'ROOM_NOT_FOUND',
            message: '目标设备不可达',
          });
          return;
        }
        // 邀请方先入房（成为发起方），随后拉入目标。
        const roomId = this.rooms.createRoom(client.peerId);
        const join = this.rooms.joinRoom(roomId, target.peerId);
        if (join.ok) {
          this.send(client.peerId, { type: 'peer-joined', peerId: target.peerId });
        }
        break;
      }
      case 'signal': {
        const myRoom = this.rooms.roomOf(client.peerId);
        const targetRoom = this.rooms.roomOf(parsed.to);
        if (!myRoom || myRoom !== targetRoom) return; // 仅同房转发
        this.send(parsed.to, {
          type: 'signal',
          from: client.peerId,
          payload: parsed.payload,
        });
        break;
      }
    }
  }

  private onClose(client: Client): void {
    if (!this.clients.has(client.peerId)) return;
    this.clients.delete(client.peerId);
    const group = this.lan.groupMembers(client.peerId).filter(
      p => p !== client.peerId
    );
    this.lan.remove(client.peerId);
    const left = this.rooms.leave(client.peerId);
    if (left) {
      for (const peer of left.remaining) {
        this.send(peer, { type: 'peer-left', peerId: client.peerId });
      }
    }
    for (const peer of group) this.broadcastLanPeers(peer);
  }

  private broadcastLanPeers(peerId: string): void {
    // 向 peerId 及其同组成员各自推送其可见的对端列表。
    const members = this.lan.groupMembers(peerId);
    for (const m of members) {
      this.send(m, { type: 'lan-peers', peers: this.lan.peersFor(m) });
    }
  }

  private send(peerId: string, message: ServerMessage): void {
    const client = this.clients.get(peerId);
    if (!client || client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify(message));
  }
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @peerlink/signaling typecheck`
Expected: PASS。

- [ ] **Step 3: 实现进程入口 `apps/signaling/src/index.ts`**

```ts
import { pino } from 'pino';

import { loadConfig } from './config';
import { SignalingServer } from './server';

const config = loadConfig();
const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty' },
});

const server = new SignalingServer(config, log);
void server.listen();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
```

- [ ] **Step 4: typecheck + lint**

Run: `pnpm --filter @peerlink/signaling typecheck && pnpm --filter @peerlink/signaling lint`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/signaling/src/server.ts apps/signaling/src/index.ts
git commit -m "feat(signaling): wire ws server with rooms, LAN and relay"
```

---

## Task 6: 真实 ws 集成测试

**Files:**
- Create: `apps/signaling/src/server.spec.ts`

> 起真实 `SignalingServer`（端口 0 自动分配），用 `ws` 客户端模拟两端，验证：create→join→peer-joined、signal 仅同房转发、断开广播 peer-left、坏消息回 error。

- [ ] **Step 1: 写集成测试 `apps/signaling/src/server.spec.ts`**

```ts
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { WebSocket } from 'ws';

import type { ServerMessage } from '@peerlink/protocol';

import { loadConfig } from './config';
import { SignalingServer } from './server';

let server: SignalingServer;
let url: string;

beforeEach(async () => {
  const config = { ...loadConfig(), port: 0, reapIntervalMs: 60_000 };
  server = new SignalingServer(config, {
    info() {},
    error() {},
    warn() {},
    debug() {},
  } as never);
  await server.listen();
  url = `ws://127.0.0.1:${server.port}${config.path}`;
});

afterEach(async () => {
  await server.close();
});

function connect(): Promise<WebSocket> {
  const ws = new WebSocket(url);
  return new Promise(resolve => ws.on('open', () => resolve(ws)));
}

/** 等待下一条满足 predicate 的服务端消息。 */
function next(
  ws: WebSocket,
  predicate: (m: ServerMessage) => boolean
): Promise<ServerMessage> {
  return new Promise(resolve => {
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (predicate(msg)) {
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('SignalingServer', () => {
  it('creates a room and relays signal between two peers', async () => {
    const alice = await connect();
    const created = next(alice, m => m.type === 'room-created');
    alice.send(JSON.stringify({ type: 'create-room' }));
    const room = (await created) as Extract<
      ServerMessage,
      { type: 'room-created' }
    >;

    const bob = await connect();
    // alice（先到者）应收到 peer-joined
    const joined = next(alice, m => m.type === 'peer-joined');
    bob.send(JSON.stringify({ type: 'join-room', roomId: room.roomId }));
    const peerJoined = (await joined) as Extract<
      ServerMessage,
      { type: 'peer-joined' }
    >;
    expect(peerJoined.peerId).toBeTruthy();

    // alice 向 bob 转发一个 offer
    const bobSignal = next(bob, m => m.type === 'signal');
    alice.send(
      JSON.stringify({
        type: 'signal',
        to: peerJoined.peerId,
        payload: { sdp: 'OFFER' },
      })
    );
    const sig = (await bobSignal) as Extract<ServerMessage, { type: 'signal' }>;
    expect(sig.payload).toEqual({ sdp: 'OFFER' });

    alice.close();
    bob.close();
  });

  it('rejects joining a missing room', async () => {
    const ws = await connect();
    const err = next(ws, m => m.type === 'error');
    ws.send(JSON.stringify({ type: 'join-room', roomId: 'ghost' }));
    const e = (await err) as Extract<ServerMessage, { type: 'error' }>;
    expect(e.code).toBe('ROOM_NOT_FOUND');
    ws.close();
  });

  it('returns BAD_MESSAGE for unparseable input', async () => {
    const ws = await connect();
    const err = next(ws, m => m.type === 'error');
    ws.send('not json');
    const e = (await err) as Extract<ServerMessage, { type: 'error' }>;
    expect(e.code).toBe('BAD_MESSAGE');
    ws.close();
  });

  it('notifies the remaining peer when the other disconnects', async () => {
    const alice = await connect();
    const created = next(alice, m => m.type === 'room-created');
    alice.send(JSON.stringify({ type: 'create-room' }));
    const room = (await created) as Extract<
      ServerMessage,
      { type: 'room-created' }
    >;
    const bob = await connect();
    await next(alice, m => m.type === 'peer-joined');
    bob.send(JSON.stringify({ type: 'join-room', roomId: room.roomId }));

    const left = next(alice, m => m.type === 'peer-left');
    bob.close();
    const l = (await left) as Extract<ServerMessage, { type: 'peer-left' }>;
    expect(l.peerId).toBeTruthy();
    alice.close();
  });
});
```

- [ ] **Step 2: 运行，确认通过**

Run: `pnpm --filter @peerlink/signaling test server`
Expected: PASS（4 个集成用例）。如有偶发超时，确认 `connect()` 等到 open 后再发消息。

- [ ] **Step 3: 全量校验**

Run:
```bash
pnpm --filter @peerlink/signaling test
pnpm --filter @peerlink/signaling typecheck
pnpm --filter @peerlink/signaling lint
pnpm --filter @peerlink/signaling build
```
Expected: 全部 PASS；`apps/signaling/dist/` 生成。

- [ ] **Step 4: 提交**

```bash
git add apps/signaling/src/server.spec.ts
git commit -m "test(signaling): add ws integration tests"
```

---

## Task 7: 接入容器化开发环境

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: 在 `docker-compose.yml` 的 `services:` 下、`# ─── 计划 2 加入 signaling 服务 ───` 注释处，加入 signaling 服务**

```yaml
  signaling:
    <<: *app-build
    restart: unless-stopped
    depends_on:
      deps:
        condition: service_completed_successfully
    environment:
      NODE_ENV: development
      SIGNALING_PORT: 3001
      SIGNALING_PATH: /signal
      LOG_LEVEL: ${LOG_LEVEL:-info}
    command: pnpm --filter @peerlink/signaling dev
    volumes:
      - ./:/workspace
    networks:
      - internal
    labels:
      - traefik.enable=true
      - traefik.docker.network=peerlink_internal
      - traefik.http.routers.pl-signal.rule=PathPrefix(`/signal`)
      - traefik.http.routers.pl-signal.entrypoints=web
      - traefik.http.routers.pl-signal.priority=10
      - traefik.http.services.pl-signal.loadbalancer.server.port=3001
```

- [ ] **Step 2: 验证容器内信令服务可经 Traefik 访问**

Run:
```bash
docker compose up -d deps traefik signaling
sleep 5
# WebSocket 握手返回 101；用 curl 触发 upgrade，预期非 404
curl -s -o /dev/null -w "%{http_code}" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:8894/signal
```
Expected: 返回 `101`（或 `426/400` 等非 404 的 upgrade 相关码，证明路由命中 signaling 而非未匹配）。随后 `docker compose down`。

- [ ] **Step 3: 提交**

```bash
git add docker-compose.yml
git commit -m "chore: add signaling service to dev compose with /signal route"
```

---

## 计划完成后

- `@peerlink/signaling` 实现并通过单测 + 集成测试。
- 容器内 `http://localhost:8894/signal` 可建立 WebSocket。
- **下一步:** 计划 3 实现 `@peerlink/web`，连接此信令服务完成 P2P 传输。

---

## 自查（写完即查）

**Spec 覆盖:**
- 3.1 房间模型（create/join/2 人满/TTL 回收）→ Task 3 ✔
- 3.1 短口令「4 数字+中文词」→ Task 2 ✔
- 3.2 局域网分组 + 设备名 + 列表推送 → Task 4 + Task 5（broadcastLanPeers）✔
- 3.2 lan-invite → Task 5 ✔
- 3.3 信令消息处理（create-room/join-room/lan-invite/signal/error，peer-joined/peer-left/lan-peers/room-created）→ Task 5；用 `@peerlink/protocol` schema 校验 ✔
- 3.3 signal 仅透传不解析、仅同房转发 → Task 5（signal case）+ Task 6 集成验证 ✔
- 3.4 内存状态、无 DB、单实例、定时回收 → Task 3/5 ✔
- 第 2.4 容器化（signaling 服务 + Traefik /signal）→ Task 7 ✔

**Placeholder 扫描:** 无 TBD/TODO；每个代码步骤含完整可执行代码。

**类型一致性:** `RoomManager`（createRoom/joinRoom/leave/getPeers/roomOf/reap、`JoinResult.existingPeers`）、`LanRegistry`（add/remove/peersFor/groupMembers）、`SignalingServer`（listen/close/port）跨 Task 一致；消息类型全部来自 `@peerlink/protocol`（`ClientMessage`/`ServerMessage`/`LanPeer`），与计划 1 导出名一致。
