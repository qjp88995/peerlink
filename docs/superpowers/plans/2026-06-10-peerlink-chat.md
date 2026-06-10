# PeerLink 对话 + 文件传输（统一时间线 IM）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 PeerLink 从「单次非对称收发文件」改造为「对称 IM」：两端在同一房间内，于统一时间线里互发文字消息与文件（文件保留 accept/reject 确认），纯会话内存。

**Architecture:** 协议层给文件控制消息加 `transferId`、新增 `chat` 类型，`fileId` 升级为发送方会话内单调递增（数据帧不动）。新增对称编排器 `core/conversation.ts`（一个可单测的 `Conversation` 类 + 一个接线用的 `startConversation`），按 `transferId`/`fileId` 多路复用多次文件传输与文字消息，替换 `lib/transfer-session.ts`。状态从单进度改为时间线 `items[]`，UI 重构为 `features/chat/`。

**Tech Stack:** TypeScript / zod（协议）；React 19 + Vite + Tailwind v4 + zustand + lucide-react + sonner（web）；Vitest 同目录共置单测。

**迁移策略（保持每次提交可编译/可测）：** 新核心与新 UI 全部「并行新建」，老路径（`transfer-session.ts` / `SendPanel` / `ReceivePanel` / 旧 `store.ts`）保留到最后一个「切换」任务一次性删除。Task 2 会顺手补一行 `transfer-session.ts` 的调用以适配新签名，使其在被删除前始终可编译。

---

## 文件结构

| 路径                                                 | 责任                                                               | 任务 |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ---- |
| `packages/protocol/src/control.ts`                   | 控制消息 schema：加 `chat`、文件消息加 `transferId`                | T1   |
| `packages/protocol/src/control.spec.ts`              | schema 往返/拒绝测试                                               | T1   |
| `apps/web/src/core/sender.ts`                        | `buildManifest(files, transferId)`、`TransferSender` 带 transferId | T2   |
| `apps/web/src/core/sender.spec.ts`                   | sender 测试随签名更新                                              | T2   |
| `apps/web/src/core/receiver.spec.ts`                 | 控制帧补 transferId（receiver 代码不变）                           | T3   |
| `apps/web/src/core/conversation.ts`                  | **新增**：`Conversation` 类 + `startConversation` 接线             | T4   |
| `apps/web/src/core/conversation.spec.ts`             | **新增**：文字/文件握手/多路复用/拒绝/断开                         | T4   |
| `apps/web/src/state/conversation-store.ts`           | **新增**：时间线 store                                             | T5   |
| `apps/web/src/state/conversation-store.spec.ts`      | **新增**：append / 进度 / 状态流转                                 | T5   |
| `apps/web/src/features/chat/TextBubble.tsx`          | 文字气泡                                                           | T6   |
| `apps/web/src/features/chat/FileBubble.tsx`          | 文件气泡（进度/状态/接收拒绝/保存）                                | T6   |
| `apps/web/src/features/chat/Composer.tsx`            | 输入框 + 发送 + 文件选择                                           | T6   |
| `apps/web/src/features/chat/Timeline.tsx`            | 渲染 items，分发气泡                                               | T6   |
| `apps/web/src/features/chat/ChatRoom.tsx`            | 容器：接线 conversation ↔ store                                    | T7   |
| `apps/web/src/routes/index.tsx`                      | 渲染 `ChatRoom mode=create`                                        | T8   |
| `apps/web/src/routes/r.$roomId.tsx`                  | 渲染 `ChatRoom mode=join`                                          | T8   |
| ~~`apps/web/src/lib/transfer-session.ts`~~           | **删除**                                                           | T8   |
| ~~`apps/web/src/features/send/SendPanel.tsx`~~       | **删除**                                                           | T8   |
| ~~`apps/web/src/features/receive/ReceivePanel.tsx`~~ | **删除**                                                           | T8   |
| ~~`apps/web/src/state/store.ts`~~                    | **删除**                                                           | T8   |

---

## Task 1: 协议层 — 加 `chat` 与 `transferId`

**Files:**

- Modify: `packages/protocol/src/control.ts`
- Test: `packages/protocol/src/control.spec.ts`

- [ ] **Step 1: 重写 control.spec.ts 为新 schema 断言（先让它失败）**

```ts
import { describe, expect, it } from 'vitest';

import { controlMessageSchema } from './control';

describe('controlMessageSchema', () => {
  it('accepts a chat message', () => {
    const msg = { type: 'chat', msgId: 'm1', text: 'hello', ts: 1717999999 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('rejects chat text over 8192 chars', () => {
    expect(() =>
      controlMessageSchema.parse({
        type: 'chat',
        msgId: 'm1',
        text: 'x'.repeat(8193),
        ts: 1,
      })
    ).toThrow();
  });

  it('accepts a manifest carrying a transferId', () => {
    const msg = {
      type: 'manifest',
      transferId: 't1',
      totalSize: 2048,
      files: [
        { fileId: 0, name: 'a.jpg', size: 1024, relativePath: 'photos/a.jpg' },
        { fileId: 1, name: 'b.txt', size: 1024, relativePath: 'b.txt' },
      ],
    };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('requires transferId on manifest', () => {
    expect(() =>
      controlMessageSchema.parse({ type: 'manifest', totalSize: 0, files: [] })
    ).toThrow();
  });

  it('accepts accept / reject with transferId', () => {
    expect(
      controlMessageSchema.parse({ type: 'accept', transferId: 't1' })
    ).toEqual({ type: 'accept', transferId: 't1' });
    expect(
      controlMessageSchema.parse({ type: 'reject', transferId: 't1' })
    ).toEqual({ type: 'reject', transferId: 't1' });
  });

  it('accepts file-complete with crc32 (no transferId)', () => {
    const msg = { type: 'file-complete', fileId: 0, crc32: 0xcbf43926 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts transfer-complete and cancel with transferId', () => {
    expect(
      controlMessageSchema.parse({
        type: 'transfer-complete',
        transferId: 't1',
      })
    ).toEqual({ type: 'transfer-complete', transferId: 't1' });
    expect(
      controlMessageSchema.parse({
        type: 'cancel',
        transferId: 't1',
        reason: 'user',
      })
    ).toEqual({ type: 'cancel', transferId: 't1', reason: 'user' });
  });

  it('rejects negative file size', () => {
    expect(() =>
      controlMessageSchema.parse({
        type: 'manifest',
        transferId: 't1',
        totalSize: -1,
        files: [],
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/protocol test`
Expected: FAIL（chat 未定义 / manifest 缺 transferId 仍被接受）

- [ ] **Step 3: 修改 control.ts**

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

const chat = z.object({
  type: z.literal('chat'),
  msgId: z.string(),
  text: z.string().max(8192),
  ts: z.number().int(),
});

const manifest = z.object({
  type: z.literal('manifest'),
  transferId: z.string(),
  files: z.array(fileEntrySchema),
  totalSize: z.number().int().nonnegative(),
});
const accept = z.object({ type: z.literal('accept'), transferId: z.string() });
const reject = z.object({ type: z.literal('reject'), transferId: z.string() });
const fileComplete = z.object({
  type: z.literal('file-complete'),
  fileId: z.number().int().nonnegative(),
  crc32: z.number().int().nonnegative(),
});
const transferComplete = z.object({
  type: z.literal('transfer-complete'),
  transferId: z.string(),
});
const cancel = z.object({
  type: z.literal('cancel'),
  transferId: z.string(),
  reason: z.string().optional(),
});

export const controlMessageSchema = z.discriminatedUnion('type', [
  chat,
  manifest,
  accept,
  reject,
  fileComplete,
  transferComplete,
  cancel,
]);
export type ControlMessage = z.infer<typeof controlMessageSchema>;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/protocol test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/control.ts packages/protocol/src/control.spec.ts
git commit -m "feat(protocol): add chat message and transferId to file control messages"
```

---

## Task 2: sender — `buildManifest`/`TransferSender` 带 transferId

**Files:**

- Modify: `apps/web/src/core/sender.ts`
- Modify: `apps/web/src/lib/transfer-session.ts:51,82-87`（仅适配调用，使其编译；该文件 T8 删除）
- Test: `apps/web/src/core/sender.spec.ts`

- [ ] **Step 1: 更新 sender.spec.ts（先失败）**

把 `buildManifest` 调用改为带 transferId，并断言 manifest 含 transferId、`TransferSender` 发出带 transferId 的 transfer-complete：

```ts
import { describe, expect, it } from 'vitest';

import { decodeFrame } from '@peerlink/protocol';

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
  it('includes transferId, sums total size and lists entries', () => {
    const m = buildManifest(
      [memSource(0, 'a.txt', [1, 2, 3]), memSource(1, 'dir/b.txt', [4, 5])],
      't1'
    );
    expect(m.type).toBe('manifest');
    expect(m.transferId).toBe('t1');
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
  it('emits data chunks then file-complete then transfer-complete with transferId', async () => {
    const ch = new RecordingChannel();
    const files = [memSource(0, 'a.bin', [10, 20, 30, 40, 50])];
    const sender = new TransferSender(ch, files, {
      transferId: 't1',
      chunkSize: 2,
    });
    await sender.streamAll();

    const decoded = ch.frames.map(decodeFrame);
    const dataFrames = decoded.filter(f => f.kind === 'data');
    expect(dataFrames).toHaveLength(3);

    const controls = decoded.filter(f => f.kind === 'control');
    const msgs = controls.map(c =>
      c.kind === 'control' ? (c.message as { type: string }) : { type: '' }
    );
    expect(msgs.map(m => m.type)).toEqual([
      'file-complete',
      'transfer-complete',
    ]);
    expect(msgs[1]).toMatchObject({
      type: 'transfer-complete',
      transferId: 't1',
    });

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
      transferId: 't1',
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
      transferId: 't1',
      chunkSize: 2,
      highWater: 1000,
      lowWater: 500,
    });
    await sender.streamAll();
    expect(drainCalls).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @peerlink/web test -- sender`
Expected: FAIL（`buildManifest` 第二参数、`TransferSenderOptions.transferId` 未定义）

- [ ] **Step 3: 修改 sender.ts**

`ManifestMessage` 加 `transferId`；`buildManifest` 增参；`TransferSenderOptions` 加 `transferId`；构造函数保存；`streamAll` 末尾 transfer-complete 带 transferId：

```ts
export interface ManifestMessage {
  type: 'manifest';
  transferId: string;
  files: FileEntry[];
  totalSize: number;
}

export function buildManifest(
  files: SourceFile[],
  transferId: string
): ManifestMessage {
  return {
    type: 'manifest',
    transferId,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    files: files.map(f => ({
      fileId: f.fileId,
      name: f.name,
      size: f.size,
      relativePath: f.relativePath,
    })),
  };
}
```

```ts
export interface TransferSenderOptions {
  transferId: string;
  chunkSize?: number;
  highWater?: number;
  lowWater?: number;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

export class TransferSender {
  private transferId: string;
  private chunkSize: number;
  private highWater: number;
  private lowWater: number;
  private onProgress?: TransferSenderOptions['onProgress'];
  private totalBytes: number;

  constructor(
    private channel: SendChannel,
    private files: SourceFile[],
    opts: TransferSenderOptions
  ) {
    this.transferId = opts.transferId;
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.highWater = opts.highWater ?? BUFFER_HIGH_WATERMARK;
    this.lowWater = opts.lowWater ?? BUFFER_LOW_WATERMARK;
    this.onProgress = opts.onProgress;
    this.totalBytes = files.reduce((s, f) => s + f.size, 0);
  }
```

把 `streamAll` 最后一行改为：

```ts
this.channel.send(
  encodeControlFrame({
    type: 'transfer-complete',
    transferId: this.transferId,
  })
);
```

- [ ] **Step 4: 适配 `lib/transfer-session.ts`（保持编译，T8 删除）**

在 `startSendSession` 顶部生成一个一次性 transferId，并传入两处调用：

第 51 行：

```ts
const transferId = crypto.randomUUID();
const manifest = buildManifest(sources, transferId);
```

`new TransferSender(...)` 调用（约 83-87 行）加 `transferId`：

```ts
const sender = new TransferSender(rtcSendChannel(peer.channel), sources, {
  transferId,
  onProgress: throttleProgress(cb.onProgress),
});
```

- [ ] **Step 5: 运行测试与 typecheck 确认通过**

Run: `pnpm --filter @peerlink/web test -- sender && pnpm --filter @peerlink/web typecheck`
Expected: PASS（注意：此刻 `receiver.spec` 仍会红，T3 修复）

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/core/sender.ts apps/web/src/core/sender.spec.ts apps/web/src/lib/transfer-session.ts
git commit -m "feat(web): thread transferId through buildManifest and TransferSender"
```

---

## Task 3: receiver 测试适配 transferId（代码不变）

**Files:**

- Test: `apps/web/src/core/receiver.spec.ts`

`TransferReceiver` 代码无需改动（它用 `controlMessageSchema.parse` 解析，忽略 transferId）。但现有测试构造的 `transfer-complete`/`cancel` 缺 transferId，新 schema 会拒绝 → 必须更新测试。

- [ ] **Step 1: 更新 receiver.spec.ts 的控制帧带 transferId**

把第 49 行与第 73 行改为：

```ts
await r.handleFrame(
  encodeControlFrame({ type: 'transfer-complete', transferId: 't1' })
);
```

```ts
await r.handleFrame(
  encodeControlFrame({ type: 'cancel', transferId: 't1', reason: 'x' })
);
```

（`manifest` 局部常量与 `file-complete` 帧无需改：receiver 构造用的是 `ReceiverManifest` 接口对象，不经过 schema；file-complete schema 未变。）

- [ ] **Step 2: 运行确认通过**

Run: `pnpm --filter @peerlink/web test -- receiver`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/core/receiver.spec.ts
git commit -m "test(web): add transferId to receiver control-frame fixtures"
```

---

## Task 4: 核心多路复用器 `core/conversation.ts`

**Files:**

- Create: `apps/web/src/core/conversation.ts`
- Test: `apps/web/src/core/conversation.spec.ts`

设计：`Conversation` 类是纯逻辑核心（注入 `SendChannel` 与 `makeWriter`，可单测）；`startConversation` 是薄接线层（创建 `SignalingClient` + `PeerConnection`，把 dc 消息喂给 `Conversation`）。

- [ ] **Step 1: 写 conversation.spec.ts（先失败）**

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  controlMessageSchema,
  decodeFrame,
  encodeControlFrame,
  encodeDataFrame,
  type FileEntry,
} from '@peerlink/protocol';

import type { SendChannel } from './channel';
import { Conversation } from './conversation';
import type { Writer } from './storage/writer';

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

function controls(ch: RecordingChannel) {
  return ch.frames
    .map(decodeFrame)
    .filter(f => f.kind === 'control')
    .map(f =>
      f.kind === 'control' ? controlMessageSchema.parse(f.message) : null
    );
}

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

function fileBlob(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name);
}

function setup() {
  const ch = new RecordingChannel();
  const { writer, data } = mockWriter();
  const cb = {
    onRoom: vi.fn(),
    onConnection: vi.fn(),
    onText: vi.fn(),
    onIncomingFiles: vi.fn(),
    onTransferStart: vi.fn(),
    onProgress: vi.fn(),
    onTransferDone: vi.fn(),
    onTransferFailed: vi.fn(),
    onTransferRejected: vi.fn(),
  };
  const conv = new Conversation({
    channel: ch,
    makeWriter: async () => writer,
    callbacks: cb,
  });
  return { ch, conv, cb, writer, data };
}

describe('Conversation — text', () => {
  it('sendText emits a chat control frame and returns the item', () => {
    const { ch, conv } = setup();
    const item = conv.sendText('hello');
    expect(item.text).toBe('hello');
    const [msg] = controls(ch);
    expect(msg).toMatchObject({ type: 'chat', text: 'hello', msgId: item.id });
  });

  it('incoming chat frame fires onText with dir in', async () => {
    const { conv, cb } = setup();
    await conv.handleIncoming(
      encodeControlFrame({ type: 'chat', msgId: 'm', text: 'yo', ts: 1 })
    );
    expect(cb.onText).toHaveBeenCalledWith(
      expect.objectContaining({ dir: 'in', text: 'yo', id: 'm' })
    );
  });
});

describe('Conversation — incoming file handshake', () => {
  it('accepts a transfer, streams data into the writer, completes', async () => {
    const { ch, conv, cb, data } = setup();
    const files: FileEntry[] = [
      { fileId: 0, name: 'a.bin', size: 3, relativePath: 'a.bin' },
    ];
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'T1',
        files,
        totalSize: 3,
      })
    );
    expect(cb.onIncomingFiles).toHaveBeenCalledWith('T1', files, 3);

    await conv.acceptTransfer('T1');
    expect(controls(ch).at(-1)).toEqual({ type: 'accept', transferId: 'T1' });

    await conv.handleIncoming(encodeDataFrame(0, 0, new Uint8Array([7, 8, 9])));
    await conv.handleIncoming(
      encodeControlFrame({ type: 'transfer-complete', transferId: 'T1' })
    );
    expect(data.get(0)).toEqual([7, 8, 9]);
    expect(cb.onProgress).toHaveBeenCalledWith('T1', 3, 3);
    expect(cb.onTransferDone).toHaveBeenCalledWith('T1');
  });

  it('rejectTransfer sends a reject frame', async () => {
    const { ch, conv } = setup();
    const files: FileEntry[] = [
      { fileId: 0, name: 'a.bin', size: 1, relativePath: 'a.bin' },
    ];
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'T1',
        files,
        totalSize: 1,
      })
    );
    conv.rejectTransfer('T1');
    expect(controls(ch).at(-1)).toEqual({ type: 'reject', transferId: 'T1' });
  });
});

describe('Conversation — outgoing file handshake', () => {
  it('sendFiles emits a manifest with monotonic fileIds; accept triggers streaming', async () => {
    const { ch, conv, cb } = setup();
    const out = conv.sendFiles([fileBlob('a.bin', [1, 2, 3, 4])]);
    expect(out.entries[0].fileId).toBe(0);
    const manifest = controls(ch).find(m => m?.type === 'manifest');
    expect(manifest).toMatchObject({
      type: 'manifest',
      transferId: out.transferId,
    });

    await conv.handleIncoming(
      encodeControlFrame({ type: 'accept', transferId: out.transferId })
    );
    expect(cb.onTransferStart).toHaveBeenCalledWith(out.transferId);
    // data + file-complete + transfer-complete streamed out
    const types = ch.frames.map(decodeFrame).map(f => f.kind);
    expect(types).toContain('data');
    expect(cb.onTransferDone).toHaveBeenCalledWith(out.transferId);
  });

  it('peer reject marks the outgoing transfer rejected', async () => {
    const { conv, cb } = setup();
    const out = conv.sendFiles([fileBlob('a.bin', [1])]);
    await conv.handleIncoming(
      encodeControlFrame({ type: 'reject', transferId: out.transferId })
    );
    expect(cb.onTransferRejected).toHaveBeenCalledWith(out.transferId);
  });
});

describe('Conversation — multiplexing', () => {
  it('routes interleaved data frames to the right writer by fileId', async () => {
    const ch = new RecordingChannel();
    const w1 = mockWriter();
    const w2 = mockWriter();
    const writers = [w1.writer, w2.writer];
    let n = 0;
    const cb = {
      onRoom: vi.fn(),
      onConnection: vi.fn(),
      onText: vi.fn(),
      onIncomingFiles: vi.fn(),
      onTransferStart: vi.fn(),
      onProgress: vi.fn(),
      onTransferDone: vi.fn(),
      onTransferFailed: vi.fn(),
      onTransferRejected: vi.fn(),
    };
    const conv = new Conversation({
      channel: ch,
      makeWriter: async () => writers[n++],
      callbacks: cb,
    });
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'A',
        files: [{ fileId: 0, name: 'a', size: 1, relativePath: 'a' }],
        totalSize: 1,
      })
    );
    await conv.acceptTransfer('A');
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'B',
        files: [{ fileId: 1, name: 'b', size: 1, relativePath: 'b' }],
        totalSize: 1,
      })
    );
    await conv.acceptTransfer('B');

    await conv.handleIncoming(encodeDataFrame(1, 0, new Uint8Array([99])));
    await conv.handleIncoming(encodeDataFrame(0, 0, new Uint8Array([11])));

    expect(w1.data.get(0)).toEqual([11]);
    expect(w2.data.get(1)).toEqual([99]);
  });
});

describe('Conversation — connection', () => {
  it('closeRemote marks in-flight transfers failed', async () => {
    const { conv, cb } = setup();
    const files: FileEntry[] = [
      { fileId: 0, name: 'a', size: 9, relativePath: 'a' },
    ];
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'T1',
        files,
        totalSize: 9,
      })
    );
    await conv.acceptTransfer('T1');
    conv.closeRemote();
    expect(cb.onConnection).toHaveBeenCalledWith('closed');
    expect(cb.onTransferFailed).toHaveBeenCalledWith('T1', expect.anything());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation`
Expected: FAIL（`./conversation` 不存在）

- [ ] **Step 3: 实现 conversation.ts**

```ts
import {
  controlMessageSchema,
  decodeFrame,
  encodeControlFrame,
  type FileEntry,
} from '@peerlink/protocol';

import { rtcSendChannel, type SendChannel } from './channel';
import { PeerConnection } from './peer-connection';
import { TransferReceiver } from './receiver';
import {
  browserFileToSource,
  buildManifest,
  type SourceFile,
  TransferSender,
} from './sender';
import { SignalingClient } from './signaling-client';
import { BlobWriter } from './storage/blob-writer';
import { FsAccessWriter } from './storage/fs-access-writer';
import {
  decideWriter,
  detectCapabilities,
  manifestHasDirectory,
  type Writer,
} from './storage/writer';
import { iceServersFromEnv } from '@/lib/ice-config';
import { throttleProgress } from '@/lib/progress-throttle';

export type Connection =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error';

export interface TextItem {
  id: string;
  dir: 'out' | 'in';
  text: string;
  ts: number;
}

export interface OutgoingFiles {
  transferId: string;
  entries: FileEntry[];
  totalSize: number;
}

export interface ConversationCallbacks {
  onRoom?: (roomId: string) => void;
  onConnection?: (state: Connection) => void;
  onText?: (item: TextItem) => void;
  onIncomingFiles?: (
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ) => void;
  onTransferStart?: (transferId: string) => void;
  onProgress?: (transferId: string, sent: number, total: number) => void;
  onTransferDone?: (transferId: string) => void;
  onTransferFailed?: (transferId: string, reason?: string) => void;
  onTransferRejected?: (transferId: string) => void;
}

interface OutgoingState {
  transferId: string;
  sources: SourceFile[];
}

interface IncomingState {
  transferId: string;
  files: FileEntry[];
  totalSize: number;
  receiver?: TransferReceiver;
}

export interface ConversationDeps {
  channel: SendChannel;
  makeWriter: (files: FileEntry[]) => Promise<Writer>;
  callbacks: ConversationCallbacks;
}

/** 对称会话核心：一条 DataChannel 上多路复用文字 + 多次文件传输。 */
export class Conversation {
  private channel: SendChannel;
  private makeWriter: ConversationDeps['makeWriter'];
  private cb: ConversationCallbacks;

  private nextFileId = 0;
  private outgoing = new Map<string, OutgoingState>();
  private incoming = new Map<string, IncomingState>();
  private fileIdToTransfer = new Map<number, string>();
  private active = new Set<string>(); // 进行中的 transferId（双向）

  constructor(deps: ConversationDeps) {
    this.channel = deps.channel;
    this.makeWriter = deps.makeWriter;
    this.cb = deps.callbacks;
  }

  setChannel(channel: SendChannel): void {
    this.channel = channel;
  }

  sendText(text: string): TextItem {
    const item: TextItem = {
      id: crypto.randomUUID(),
      dir: 'out',
      text,
      ts: Date.now(),
    };
    this.channel.send(
      encodeControlFrame({
        type: 'chat',
        msgId: item.id,
        text,
        ts: item.ts,
      })
    );
    return item;
  }

  sendFiles(files: File[]): OutgoingFiles {
    const transferId = crypto.randomUUID();
    const sources = files.map(f => browserFileToSource(f, this.nextFileId++));
    const manifest = buildManifest(sources, transferId);
    this.outgoing.set(transferId, { transferId, sources });
    this.channel.send(encodeControlFrame(manifest));
    return {
      transferId,
      entries: manifest.files,
      totalSize: manifest.totalSize,
    };
  }

  async acceptTransfer(transferId: string): Promise<void> {
    const inc = this.incoming.get(transferId);
    if (!inc) return;
    const writer = await this.makeWriter(inc.files);
    const total = inc.totalSize;
    inc.receiver = new TransferReceiver(
      { type: 'manifest', files: inc.files, totalSize: total },
      writer,
      {
        onProgress: throttleProgress((received, t) =>
          this.cb.onProgress?.(transferId, received, t)
        ),
        onComplete: () => {
          this.active.delete(transferId);
          this.cb.onTransferDone?.(transferId);
        },
        onCancel: reason => {
          this.active.delete(transferId);
          this.cb.onTransferFailed?.(transferId, reason);
        },
      }
    );
    for (const f of inc.files) this.fileIdToTransfer.set(f.fileId, transferId);
    this.active.add(transferId);
    this.cb.onTransferStart?.(transferId);
    this.channel.send(encodeControlFrame({ type: 'accept', transferId }));
  }

  rejectTransfer(transferId: string): void {
    this.incoming.delete(transferId);
    this.channel.send(encodeControlFrame({ type: 'reject', transferId }));
  }

  async handleIncoming(bytes: Uint8Array): Promise<void> {
    const frame = decodeFrame(bytes);
    if (frame.kind === 'data') {
      const tid = this.fileIdToTransfer.get(frame.fileId);
      const inc = tid ? this.incoming.get(tid) : undefined;
      if (!inc?.receiver) {
        console.warn(`drop data frame for unknown fileId ${frame.fileId}`);
        return;
      }
      await inc.receiver.handleFrame(bytes);
      return;
    }
    const msg = controlMessageSchema.parse(frame.message);
    switch (msg.type) {
      case 'chat':
        this.cb.onText?.({
          id: msg.msgId,
          dir: 'in',
          text: msg.text,
          ts: msg.ts,
        });
        return;
      case 'manifest':
        this.incoming.set(msg.transferId, {
          transferId: msg.transferId,
          files: msg.files,
          totalSize: msg.totalSize,
        });
        this.cb.onIncomingFiles?.(msg.transferId, msg.files, msg.totalSize);
        return;
      case 'accept': {
        const out = this.outgoing.get(msg.transferId);
        if (!out) return;
        this.active.add(msg.transferId);
        this.cb.onTransferStart?.(msg.transferId);
        const sender = new TransferSender(this.channel, out.sources, {
          transferId: msg.transferId,
          onProgress: throttleProgress((sent, total) =>
            this.cb.onProgress?.(msg.transferId, sent, total)
          ),
        });
        await sender.streamAll();
        this.active.delete(msg.transferId);
        this.cb.onTransferDone?.(msg.transferId);
        return;
      }
      case 'reject':
        this.outgoing.delete(msg.transferId);
        this.cb.onTransferRejected?.(msg.transferId);
        return;
      case 'file-complete':
      case 'transfer-complete':
      case 'cancel': {
        const tid =
          msg.type === 'file-complete'
            ? this.fileIdToTransfer.get(msg.fileId)
            : msg.transferId;
        const inc = tid ? this.incoming.get(tid) : undefined;
        if (!inc?.receiver) {
          console.warn(`drop control ${msg.type} for unknown transfer`);
          return;
        }
        await inc.receiver.handleFrame(bytes);
        return;
      }
    }
  }

  /** 对端断开：进行中传输全部标记失败。 */
  closeRemote(): void {
    this.cb.onConnection?.('closed');
    for (const tid of this.active)
      this.cb.onTransferFailed?.(tid, '对方已离开');
    this.active.clear();
  }
}

function signalUrl(): string {
  if (import.meta.env.VITE_SIGNAL_URL) return import.meta.env.VITE_SIGNAL_URL;
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

async function defaultMakeWriter(files: FileEntry[]): Promise<Writer> {
  const decision = decideWriter(detectCapabilities(), {
    fileCount: files.length,
    hasDirectory: manifestHasDirectory(files),
  });
  if (decision.kind === 'unsupported') throw new Error(decision.reason);
  if (decision.kind === 'fs-access') {
    const root = await window.showDirectoryPicker!();
    return new FsAccessWriter({ files }, root);
  }
  return new BlobWriter(
    { files },
    { onFile: (name, blob) => triggerDownload(name, blob) }
  );
}

export interface ConversationHandle {
  conversation: Conversation;
  sendText: (text: string) => TextItem;
  sendFiles: (files: File[]) => OutgoingFiles;
  acceptTransfer: (transferId: string) => Promise<void>;
  rejectTransfer: (transferId: string) => void;
  close: () => void;
}

/** 接线层：建立信令 + WebRTC，把 dc 消息喂给 Conversation。 */
export function startConversation(
  init: { mode: 'create' } | { mode: 'join'; roomId: string },
  callbacks: ConversationCallbacks
): ConversationHandle {
  const sig = new SignalingClient(signalUrl());
  let peer: PeerConnection | undefined;
  let targetPeerId: string | undefined;

  const conv = new Conversation({
    // 占位通道：通道未开时调用方应被 UI 禁用；真正通道在 onChannelOpen 注入
    channel: {
      send: () => {
        throw new Error('channel not open');
      },
      bufferedAmount: 0,
      waitForDrain: () => Promise.resolve(),
    },
    makeWriter: defaultMakeWriter,
    callbacks,
  });

  const send = (payload: object) =>
    targetPeerId &&
    sig.signal(targetPeerId, payload as Record<string, unknown>);

  function buildPeer(onSignal: (p: object) => void) {
    return new PeerConnection({
      iceServers: iceServersFromEnv(),
      onSignal,
      onChannelOpen: dc => {
        conv.setChannel(rtcSendChannel(dc));
        callbacks.onConnection?.('connected');
      },
      onMessage: bytes => void conv.handleIncoming(bytes),
      onStateChange: state => {
        if (
          state === 'failed' ||
          state === 'disconnected' ||
          state === 'closed'
        ) {
          conv.closeRemote();
        }
      },
    });
  }

  sig.on(
    'error',
    (_c, m) => callbacks.onConnection?.('error') ?? console.warn(m)
  );

  if (init.mode === 'create') {
    callbacks.onConnection?.('waiting');
    sig.on('open', () => sig.createRoom());
    sig.on('room-created', roomId => callbacks.onRoom?.(roomId));
    sig.on('peer-joined', async peerId => {
      targetPeerId = peerId;
      callbacks.onConnection?.('connecting');
      peer = buildPeer(send);
      await peer.startAsInitiator();
    });
    sig.on('signal', async (_from, payload) => {
      const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
      if (p.sdp) await peer?.acceptAnswer(p.sdp);
      else if (p.candidate) await peer?.addCandidate(p.candidate);
    });
  } else {
    sig.on('open', () => sig.joinRoom(init.roomId));
    sig.on('signal', async (from, payload) => {
      targetPeerId = from;
      const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
      if (!peer) {
        callbacks.onConnection?.('connecting');
        peer = buildPeer(out => targetPeerId && sig.signal(targetPeerId, out));
      }
      if (p.sdp) await peer.acceptOffer(p.sdp);
      else if (p.candidate) await peer.addCandidate(p.candidate);
    });
  }

  return {
    conversation: conv,
    sendText: t => conv.sendText(t),
    sendFiles: f => conv.sendFiles(f),
    acceptTransfer: t => conv.acceptTransfer(t),
    rejectTransfer: t => conv.rejectTransfer(t),
    close: () => {
      peer?.close();
      sig.close();
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation`
Expected: PASS（7 个用例）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS（`transfer-session.ts` 与旧 panel 仍在，应仍可编译）

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/core/conversation.ts apps/web/src/core/conversation.spec.ts
git commit -m "feat(web): add Conversation multiplexer for chat + multi-file transfer"
```

---

## Task 5: 时间线 store `state/conversation-store.ts`

**Files:**

- Create: `apps/web/src/state/conversation-store.ts`
- Test: `apps/web/src/state/conversation-store.spec.ts`

- [ ] **Step 1: 写 conversation-store.spec.ts（先失败）**

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { useConversationStore } from './conversation-store';

const files = [{ fileId: 0, name: 'a', size: 4, relativePath: 'a' }];

describe('conversation store', () => {
  beforeEach(() => useConversationStore.getState().reset());

  it('appends text items in order', () => {
    const s = useConversationStore.getState();
    s.appendText({ id: 'm1', dir: 'out', text: 'hi', ts: 1 });
    s.appendText({ id: 'm2', dir: 'in', text: 'yo', ts: 2 });
    const items = useConversationStore.getState().items;
    expect(items.map(i => i.id)).toEqual(['m1', 'm2']);
  });

  it('tracks an outgoing file from awaiting-accept to done', () => {
    const s = useConversationStore.getState();
    s.appendOutgoingFiles('T1', files, 4);
    expect(get('T1').status).toBe('awaiting-accept');
    s.updateFileStatus('T1', 'transferring');
    s.updateFileProgress('T1', 4);
    s.updateFileStatus('T1', 'done');
    const item = get('T1');
    expect(item).toMatchObject({ status: 'done', sent: 4, dir: 'out' });
  });

  it('incoming files start awaiting-accept', () => {
    useConversationStore.getState().appendIncomingFiles('T2', files, 4);
    expect(get('T2')).toMatchObject({ status: 'awaiting-accept', dir: 'in' });
  });
});

function get(id: string) {
  const item = useConversationStore.getState().items.find(i => i.id === id);
  if (!item || item.kind !== 'file') throw new Error('no file item ' + id);
  return item;
}
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation-store`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 conversation-store.ts**

```ts
import { create } from 'zustand';

import type { FileEntry } from '@peerlink/protocol';

import type { Connection, TextItem } from '@/core/conversation';

export type FileStatus =
  | 'awaiting-accept'
  | 'transferring'
  | 'done'
  | 'rejected'
  | 'failed'
  | 'canceled';

export type TimelineItem =
  | { kind: 'text'; id: string; dir: 'out' | 'in'; text: string; ts: number }
  | {
      kind: 'file';
      id: string;
      dir: 'out' | 'in';
      files: FileEntry[];
      totalSize: number;
      status: FileStatus;
      sent: number;
    };

interface ConvState {
  connection: Connection;
  roomId: string | null;
  items: TimelineItem[];
  setConnection(state: Connection): void;
  setRoom(roomId: string): void;
  appendText(item: TextItem): void;
  appendOutgoingFiles(id: string, files: FileEntry[], totalSize: number): void;
  appendIncomingFiles(id: string, files: FileEntry[], totalSize: number): void;
  updateFileStatus(id: string, status: FileStatus): void;
  updateFileProgress(id: string, sent: number): void;
  reset(): void;
}

const initial = {
  connection: 'idle' as Connection,
  roomId: null as string | null,
  items: [] as TimelineItem[],
};

function patchFile(
  items: TimelineItem[],
  id: string,
  patch: Partial<Extract<TimelineItem, { kind: 'file' }>>
): TimelineItem[] {
  return items.map(it =>
    it.kind === 'file' && it.id === id ? { ...it, ...patch } : it
  );
}

export const useConversationStore = create<ConvState>(set => ({
  ...initial,
  setConnection: connection => set({ connection }),
  setRoom: roomId => set({ roomId }),
  appendText: item =>
    set(s => ({
      items: [
        ...s.items,
        {
          kind: 'text',
          id: item.id,
          dir: item.dir,
          text: item.text,
          ts: item.ts,
        },
      ],
    })),
  appendOutgoingFiles: (id, files, totalSize) =>
    set(s => ({
      items: [
        ...s.items,
        {
          kind: 'file',
          id,
          dir: 'out',
          files,
          totalSize,
          status: 'awaiting-accept',
          sent: 0,
        },
      ],
    })),
  appendIncomingFiles: (id, files, totalSize) =>
    set(s => ({
      items: [
        ...s.items,
        {
          kind: 'file',
          id,
          dir: 'in',
          files,
          totalSize,
          status: 'awaiting-accept',
          sent: 0,
        },
      ],
    })),
  updateFileStatus: (id, status) =>
    set(s => ({ items: patchFile(s.items, id, { status }) })),
  updateFileProgress: (id, sent) =>
    set(s => ({ items: patchFile(s.items, id, { sent }) })),
  reset: () => set({ ...initial, items: [] }),
}));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation-store`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/state/conversation-store.ts apps/web/src/state/conversation-store.spec.ts
git commit -m "feat(web): add timeline conversation store"
```

---

## Task 6: 聊天 UI 组件（展示层）

**Files:**

- Create: `apps/web/src/features/chat/TextBubble.tsx`
- Create: `apps/web/src/features/chat/FileBubble.tsx`
- Create: `apps/web/src/features/chat/Composer.tsx`
- Create: `apps/web/src/features/chat/Timeline.tsx`

纯展示组件，先用类型/构建验证（无单测，沿项目约定 UI 走 mock/手测）。先确认现有 `ui.tsx` 导出 `Button`/`Card` 与 `Progress` 组件签名（已在 SendPanel/ReceivePanel 使用）。

- [ ] **Step 1: TextBubble.tsx**

```tsx
import { cn } from '@/lib/cn';

export function TextBubble({ dir, text }: { dir: 'out' | 'in'; text: string }) {
  return (
    <div
      className={cn('flex', dir === 'out' ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm',
          dir === 'out'
            ? 'bg-signal text-surface'
            : 'border border-line bg-surface-2/60 text-fg'
        )}
      >
        {text}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: FileBubble.tsx**

```tsx
import { Check, FileDown, FileUp, X } from 'lucide-react';

import type { TimelineItem } from '@/state/conversation-store';
import { Button } from '@/features/common/ui';
import { Progress } from '@/features/common/Progress';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';

type FileItem = Extract<TimelineItem, { kind: 'file' }>;

const STATUS_LABEL: Record<FileItem['status'], string> = {
  'awaiting-accept': '等待确认',
  transferring: '传输中',
  done: '已完成',
  rejected: '已拒绝',
  failed: '失败',
  canceled: '已取消',
};

export function FileBubble({
  item,
  unsupportedReason,
  onAccept,
  onReject,
}: {
  item: FileItem;
  unsupportedReason?: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const Icon = item.dir === 'out' ? FileUp : FileDown;
  const canAct = item.dir === 'in' && item.status === 'awaiting-accept';
  return (
    <div
      className={cn(
        'flex',
        item.dir === 'out' ? 'justify-end' : 'justify-start'
      )}
    >
      <div className="flex w-72 max-w-[85%] flex-col gap-2 rounded-2xl border border-line bg-surface-2/60 p-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-fg-faint" />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">
            {item.files.length === 1
              ? item.files[0].relativePath
              : `${item.files.length} 个文件`}
          </span>
          <span className="shrink-0 font-mono text-xs text-fg-faint">
            {formatBytes(item.totalSize)}
          </span>
        </div>

        {item.status === 'transferring' && (
          <Progress received={item.sent} total={item.totalSize} />
        )}

        {canAct && unsupportedReason ? (
          <div
            role="alert"
            data-testid="unsupported"
            className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger"
          >
            {unsupportedReason}
          </div>
        ) : canAct ? (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onAccept} data-testid="accept">
              <Check className="size-4" /> 接收
            </Button>
            <Button variant="danger" onClick={onReject} data-testid="reject">
              <X className="size-4" /> 拒绝
            </Button>
          </div>
        ) : (
          <span className="text-xs text-fg-faint">
            {STATUS_LABEL[item.status]}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Composer.tsx**

```tsx
import { type ChangeEvent, type KeyboardEvent, useRef, useState } from 'react';

import { Folder, Paperclip, Send } from 'lucide-react';

import { Button } from '@/features/common/ui';

export function Composer({
  disabled,
  onSendText,
  onSendFiles,
}: {
  disabled: boolean;
  onSendText: (text: string) => void;
  onSendFiles: (files: File[]) => void;
}) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendText(trimmed);
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) onSendFiles(files);
    e.target.value = '';
  }

  return (
    <div className="flex items-end gap-2 border-t border-line bg-surface px-3 py-3">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onPick}
        data-testid="file-input"
        className="hidden"
      />
      <input
        ref={el => {
          folderInputRef.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        onChange={onPick}
        data-testid="folder-input"
        className="hidden"
      />
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        aria-label="发送文件"
      >
        <Paperclip className="size-4" />
      </Button>
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => folderInputRef.current?.click()}
        aria-label="发送文件夹"
      >
        <Folder className="size-4" />
      </Button>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        maxLength={8192}
        rows={1}
        placeholder={disabled ? '等待连接…' : '输入消息，Enter 发送'}
        data-testid="composer-input"
        className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-fg-faint disabled:opacity-50"
      />
      <Button disabled={disabled} onClick={submit} aria-label="发送">
        <Send className="size-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Timeline.tsx**

```tsx
import { useEffect, useRef } from 'react';

import {
  decideWriter,
  detectCapabilities,
  manifestHasDirectory,
} from '@/core/storage/writer';
import type { TimelineItem } from '@/state/conversation-store';

import { FileBubble } from './FileBubble';
import { TextBubble } from './TextBubble';

function unsupportedReason(item: Extract<TimelineItem, { kind: 'file' }>) {
  if (item.dir !== 'in') return undefined;
  const decision = decideWriter(detectCapabilities(), {
    fileCount: item.files.length,
    hasDirectory: manifestHasDirectory(item.files),
  });
  return decision.kind === 'unsupported' ? decision.reason : undefined;
}

export function Timeline({
  items,
  onAccept,
  onReject,
}: {
  items: TimelineItem[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
      {items.map(item =>
        item.kind === 'text' ? (
          <TextBubble key={item.id} dir={item.dir} text={item.text} />
        ) : (
          <FileBubble
            key={item.id}
            item={item}
            unsupportedReason={unsupportedReason(item)}
            onAccept={() => onAccept(item.id)}
            onReject={() => onReject(item.id)}
          />
        )
      )}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 5: typecheck 确认通过**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/features/chat/
git commit -m "feat(web): add chat presentational components (bubbles, composer, timeline)"
```

---

## Task 7: 容器 `ChatRoom.tsx`（接线 conversation ↔ store）

**Files:**

- Create: `apps/web/src/features/chat/ChatRoom.tsx`

- [ ] **Step 1: 实现 ChatRoom.tsx**

```tsx
import { useEffect, useRef } from 'react';

import { toast } from 'sonner';

import {
  type ConversationHandle,
  startConversation,
} from '@/core/conversation';
import { Card } from '@/features/common/ui';
import { RoomShare } from '@/features/share/RoomShare';
import { useConversationStore } from '@/state/conversation-store';

import { Composer } from './Composer';
import { Timeline } from './Timeline';

type Mode = { mode: 'create' } | { mode: 'join'; roomId: string };

export function ChatRoom(init: Mode) {
  const store = useConversationStore();
  const handleRef = useRef<ConversationHandle | null>(null);

  useEffect(() => {
    useConversationStore.getState().reset();
    const s = useConversationStore.getState();
    handleRef.current = startConversation(init, {
      onRoom: roomId => s.setRoom(roomId),
      onConnection: state => {
        s.setConnection(state);
        if (state === 'closed') toast.info('对方已离开');
        if (state === 'error') toast.error('连接出错');
      },
      onText: item => s.appendText(item),
      onIncomingFiles: (id, files, total) =>
        s.appendIncomingFiles(id, files, total),
      onTransferStart: id => s.updateFileStatus(id, 'transferring'),
      onProgress: (id, sent) => s.updateFileProgress(id, sent),
      onTransferDone: id => s.updateFileStatus(id, 'done'),
      onTransferFailed: id => s.updateFileStatus(id, 'failed'),
      onTransferRejected: id => s.updateFileStatus(id, 'rejected'),
    });
    return () => handleRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = store.connection === 'connected';

  // 未连接且已建房：展示分享面板
  if (!connected && store.roomId && store.items.length === 0) {
    return (
      <Card>
        <RoomShare roomId={store.roomId} />
      </Card>
    );
  }

  return (
    <Card className="flex h-[70vh] flex-col overflow-hidden p-0">
      <Timeline
        items={store.items}
        onAccept={id => void handleRef.current?.acceptTransfer(id)}
        onReject={id => handleRef.current?.rejectTransfer(id)}
      />
      <Composer
        disabled={!connected}
        onSendText={text => {
          const item = handleRef.current?.sendText(text);
          if (item) store.appendText(item);
        }}
        onSendFiles={files => {
          const out = handleRef.current?.sendFiles(files);
          if (out)
            store.appendOutgoingFiles(
              out.transferId,
              out.entries,
              out.totalSize
            );
        }}
      />
    </Card>
  );
}
```

- [ ] **Step 2: typecheck 确认通过**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/features/chat/ChatRoom.tsx
git commit -m "feat(web): wire ChatRoom container connecting Conversation to store"
```

---

## Task 8: 切换路由并删除旧路径

**Files:**

- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/routes/r.$roomId.tsx`
- Delete: `apps/web/src/lib/transfer-session.ts`
- Delete: `apps/web/src/features/send/SendPanel.tsx`
- Delete: `apps/web/src/features/receive/ReceivePanel.tsx`
- Delete: `apps/web/src/state/store.ts`
- Delete: `apps/web/src/state/store.spec.ts`

- [ ] **Step 1: 改 routes/index.tsx**

```tsx
import { createFileRoute } from '@tanstack/react-router';

import { ChatRoom } from '@/features/chat/ChatRoom';

export const Route = createFileRoute('/')({
  component: () => <ChatRoom mode="create" />,
});
```

- [ ] **Step 2: 改 routes/r.$roomId.tsx**

```tsx
import { createFileRoute } from '@tanstack/react-router';

import { ChatRoom } from '@/features/chat/ChatRoom';

export const Route = createFileRoute('/r/$roomId')({
  component: function JoinRoute() {
    const { roomId } = Route.useParams();
    return <ChatRoom mode="join" roomId={decodeURIComponent(roomId)} />;
  },
});
```

- [ ] **Step 3: 删除旧文件**

```bash
git rm apps/web/src/lib/transfer-session.ts \
  apps/web/src/features/send/SendPanel.tsx \
  apps/web/src/features/receive/ReceivePanel.tsx \
  apps/web/src/state/store.ts \
  apps/web/src/state/store.spec.ts
```

- [ ] **Step 4: 确认无残留引用**

Run: `cd apps/web && grep -rn "transfer-session\|SendPanel\|ReceivePanel\|state/store\|useTransferStore" src/ || echo CLEAN`
Expected: `CLEAN`（若有命中，删除/改写对应引用后再继续）

- [ ] **Step 5: 全量校验**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(web): switch routes to ChatRoom and remove legacy send/receive flow"
```

---

## 手动验证（用户在真实浏览器）

> 容器内服务无法在宿主机 curl；端到端手测由用户完成。

1. `pnpm dev`，浏览器开 `localhost:5173` → 自动建房，展示口令/二维码。
2. 另一标签页/设备扫码或开 `/r/<口令>` 加入 → 两端进入聊天界面，连接状态变「已连接」。
3. 双向互发文字 → 气泡左右分列、即时出现。
4. A 发文件 → B 出「接收/拒绝」气泡；B 点接收 → 双方进度条推进 → 完成后按 writer 类型保存/下载；B 反向发文件同样可行（验证双向多路复用）。
5. 多文件/目录在不支持 FS Access 的接收端 → 入站气泡显示禁用态 + 原因。
6. 关掉一端标签页 → 另一端提示「对方已离开」、Composer 禁用、进行中传输标失败。

---

## Self-Review 记录

- **Spec 覆盖**：① 协议→T1；② conversation→T4（含 chat/manifest/accept/reject/file-complete/transfer-complete/cancel 路由、fileId→transferId 多路复用、closeRemote）；③ store→T5、UI→T6/T7、路由→T8；④ 错误处理→T4(closeRemote/未知帧 warn/不兼容防御) + T6(unsupported 展示) + 手测；⑤ 测试→各任务 TDD + T6/T7 typecheck + 手测。
- **类型一致性**：`Connection`/`TextItem`/`OutgoingFiles` 由 `core/conversation.ts` 单一导出，store 与 UI 复用；store action 名（`appendText`/`appendOutgoingFiles`/`appendIncomingFiles`/`updateFileStatus`/`updateFileProgress`/`setConnection`/`setRoom`/`reset`）与 ChatRoom 调用一致；回调名（`onRoom`/`onConnection`/`onText`/`onIncomingFiles`/`onTransferStart`/`onProgress`/`onTransferDone`/`onTransferFailed`/`onTransferRejected`）在 conversation 定义、ChatRoom 消费一致。
- **占位扫描**：无 TBD/TODO；每个改码步骤均含完整代码与命令。
- **迁移安全**：旧路径保留至 T8 一次性删除；T2 顺手适配 `transfer-session.ts` 调用避免中途编译失败；唯一已知红窗：T1 之后 `receiver.spec` 短暂红，T3 修复（计划已显式说明）。
