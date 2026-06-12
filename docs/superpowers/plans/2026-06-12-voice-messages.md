# 语音消息 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在统一时间线里新增「语音消息」——录完即发、直接送达、纯内存阅后即焚的 P2P 语音条目。

**Architecture:** 音频字节经独立的 `voice-start` / `voice-complete` 控制帧 + 复用现有数据帧 `[0x01][streamId][chunkIndex][payload]` 分片传输；`Conversation` 增加一条与文件并行、纯字节（DOM-free）的语音路径；收端在内存拼回字节，由 `SessionManager` 包成 Blob + object URL 交给 store；UI 在 Composer 录音、在 Timeline 用 `VoiceBubble` 播放。信令层零改动。

**Tech Stack:** TypeScript + zod（协议）、Vitest（共置 `*.spec.ts`，纯逻辑走 TDD）、React 19 + Tailwind v4 + zustand + lucide-react（前端）、MediaRecorder / getUserMedia（录音）。

**约定提醒：** 全 ESM、pnpm。React 19 不用 forwardRef/displayName。Tailwind 用标准 utility class。`@typescript-eslint/no-explicit-any: error`——测试里如需宽松类型，用具体类型或 `as` 局部断言，勿用裸 `any`。

---

## 文件结构

新增：

- `apps/web/src/core/voice-recorder.ts`（+ `voice-recorder.spec.ts`）— MediaRecorder 封装。
- `apps/web/src/features/chat/VoiceBubble.tsx`（+ `VoiceBubble.spec.tsx`）— 语音气泡。
- `apps/web/src/features/chat/use-voice-recorder.ts`（+ `use-voice-recorder.spec.ts`）— React 录音 hook。

改动：

- `packages/protocol/src/control.ts`、`constants.ts`（schema + 常量；`index.ts` 已 `export *`，无需改）。
- `apps/web/src/core/conversation.ts`（sendVoice + 接收路由/组装 + 回调 + Handle/startConversation 接线）。
- `apps/web/src/core/session-manager.ts`（SessionStore 接口 + sendVoice + 回调接线）。
- `apps/web/src/state/conversation-store.ts`（voice TimelineItem + actions）。
- `apps/web/src/features/chat/Composer.tsx`（麦克风按钮 + 录音态）。
- `apps/web/src/features/chat/Timeline.tsx`（渲染 VoiceBubble）。
- `apps/web/src/features/chat/ConversationView.tsx`（接 `sessionManager.sendVoice`）。

信令层（`signaling-client.ts`、`apps/signaling`）：零改动。

---

### Task 1: 协议层 voice-start / voice-complete 控制帧 + 常量

**Files:**

- Modify: `packages/protocol/src/control.ts`
- Modify: `packages/protocol/src/constants.ts`
- Test: `packages/protocol/src/control.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/protocol/src/control.spec.ts` 末尾的最后一个 `});`（关闭 `describe`）之前追加：

```ts
it('accepts a voice-start message', () => {
  const msg = {
    type: 'voice-start',
    msgId: 'v1',
    streamId: 3,
    mimeType: 'audio/webm;codecs=opus',
    durationMs: 4200,
    totalSize: 8192,
    ts: 1717999999,
  };
  expect(controlMessageSchema.parse(msg)).toEqual(msg);
});

it('accepts a voice-complete message', () => {
  const msg = { type: 'voice-complete', msgId: 'v1', crc32: 123456 };
  expect(controlMessageSchema.parse(msg)).toEqual(msg);
});

it('rejects voice-start with negative streamId', () => {
  expect(() =>
    controlMessageSchema.parse({
      type: 'voice-start',
      msgId: 'v1',
      streamId: -1,
      mimeType: 'audio/webm',
      durationMs: 1,
      totalSize: 1,
      ts: 1,
    })
  ).toThrow();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/protocol test -- control.spec`
Expected: FAIL —— `voice-start` / `voice-complete` 不被 discriminatedUnion 接受。

- [ ] **Step 3: 实现 schema**

在 `packages/protocol/src/control.ts` 的 `cancel` 定义之后、`controlMessageSchema` 之前插入：

```ts
const voiceStart = z.object({
  type: z.literal('voice-start'),
  msgId: z.string(),
  streamId: z.number().int().nonnegative(),
  mimeType: z.string(),
  durationMs: z.number().int().nonnegative(),
  totalSize: z.number().int().nonnegative(),
  ts: z.number().int(),
});
const voiceComplete = z.object({
  type: z.literal('voice-complete'),
  msgId: z.string(),
  crc32: z.number().int().nonnegative(),
});
```

把这两个加进 `controlMessageSchema` 的 discriminatedUnion 数组（接在 `cancel` 后）：

```ts
export const controlMessageSchema = z.discriminatedUnion('type', [
  chat,
  manifest,
  accept,
  reject,
  fileComplete,
  transferComplete,
  cancel,
  voiceStart,
  voiceComplete,
]);
```

- [ ] **Step 4: 加常量**

在 `packages/protocol/src/constants.ts` 末尾追加：

```ts
/** 单条语音消息最大录音时长（毫秒）。 */
export const MAX_VOICE_DURATION_MS = 60 * 1000;
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @peerlink/protocol test -- control.spec`
Expected: PASS（含原有用例）。

- [ ] **Step 6: 提交**

```bash
git add packages/protocol/src/control.ts packages/protocol/src/constants.ts packages/protocol/src/control.spec.ts
git commit -m "feat(protocol): add voice-start/voice-complete control frames"
```

---

### Task 2: Conversation 发送语音（sendVoice）

**Files:**

- Modify: `apps/web/src/core/conversation.ts`
- Test: `apps/web/src/core/conversation.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/core/conversation.spec.ts` 顶部 import 块里，确认从 `@peerlink/protocol` 已导入 `crc32`；若未导入则加上 `crc32`（与现有 `decodeFrame, encodeControlFrame, encodeDataFrame` 同一处）。然后在文件主 `describe` 内追加：

```ts
it('sendVoice emits voice-start, one data frame, then voice-complete', async () => {
  const ch = new RecordingChannel();
  const conv = new Conversation({
    channel: ch,
    makeWriter: async () => mockWriter().writer,
    callbacks: {},
  });
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const { item, done } = conv.sendVoice(bytes, 'audio/webm', 1234);
  await done;

  const msgs = controls(ch);
  expect(msgs[0]).toMatchObject({
    type: 'voice-start',
    msgId: item.id,
    mimeType: 'audio/webm',
    durationMs: 1234,
    totalSize: 5,
  });
  const dataFrames = ch.frames.map(decodeFrame).filter(f => f.kind === 'data');
  expect(dataFrames.length).toBe(1);
  expect(msgs.at(-1)).toMatchObject({ type: 'voice-complete', msgId: item.id });
  expect(item).toMatchObject({ dir: 'out', durationMs: 1234, size: 5 });
});

it('sendVoice allocates streamId from the shared file counter', async () => {
  const ch = new RecordingChannel();
  const conv = new Conversation({
    channel: ch,
    makeWriter: async () => mockWriter().writer,
    callbacks: {},
  });
  conv.sendFiles([fileBlob('a.txt', [1, 2, 3])]); // 占用 fileId 0
  const { done } = conv.sendVoice(new Uint8Array([9]), 'audio/webm', 100);
  await done;
  const start = controls(ch).find(m => m?.type === 'voice-start');
  expect(start).toMatchObject({ streamId: 1 });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation.spec`
Expected: FAIL —— `conv.sendVoice is not a function`。

- [ ] **Step 3: 实现 sendVoice**

在 `apps/web/src/core/conversation.ts`：

1）扩展顶部 import（把缺的符号加进现有 `@peerlink/protocol` 解构）：

```ts
import {
  BUFFER_HIGH_WATERMARK,
  BUFFER_LOW_WATERMARK,
  controlMessageSchema,
  Crc32,
  crc32,
  decodeFrame,
  DEFAULT_CHUNK_SIZE,
  encodeControlFrame,
  encodeDataFrame,
  type FileEntry,
} from '@peerlink/protocol';
```

2）在 `TextItem` 接口附近新增：

```ts
export interface VoiceItem {
  id: string;
  dir: 'out' | 'in';
  durationMs: number;
  size: number;
  ts: number;
}
```

3）在 `Conversation` 类里（`sendFiles` 方法之后）新增：

```ts
  sendVoice(
    bytes: Uint8Array,
    mimeType: string,
    durationMs: number
  ): { item: VoiceItem; done: Promise<void> } {
    const msgId = crypto.randomUUID();
    const streamId = this.nextFileId++;
    const item: VoiceItem = {
      id: msgId,
      dir: 'out',
      durationMs,
      size: bytes.length,
      ts: Date.now(),
    };
    const done = this.streamVoice(bytes, mimeType, durationMs, msgId, streamId);
    return { item, done };
  }

  private async streamVoice(
    bytes: Uint8Array,
    mimeType: string,
    durationMs: number,
    msgId: string,
    streamId: number
  ): Promise<void> {
    this.channel.send(
      encodeControlFrame({
        type: 'voice-start',
        msgId,
        streamId,
        mimeType,
        durationMs,
        totalSize: bytes.length,
        ts: Date.now(),
      })
    );
    const crc = new Crc32();
    let chunkIndex = 0;
    for (let offset = 0; offset < bytes.length; offset += DEFAULT_CHUNK_SIZE) {
      if (this.channel.bufferedAmount > BUFFER_HIGH_WATERMARK) {
        await this.channel.waitForDrain(BUFFER_LOW_WATERMARK);
      }
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + DEFAULT_CHUNK_SIZE, bytes.length)
      );
      crc.update(chunk);
      this.channel.send(encodeDataFrame(streamId, chunkIndex, chunk));
      chunkIndex++;
    }
    this.channel.send(
      encodeControlFrame({ type: 'voice-complete', msgId, crc32: crc.digest() })
    );
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation.spec`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/conversation.ts apps/web/src/core/conversation.spec.ts
git commit -m "feat(web): Conversation.sendVoice streams voice over data channel"
```

---

### Task 3: Conversation 接收语音（组装 + CRC + 回调）

**Files:**

- Modify: `apps/web/src/core/conversation.ts`
- Test: `apps/web/src/core/conversation.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `conversation.spec.ts` 主 `describe` 内追加：

```ts
it('assembles an incoming voice message and verifies crc', async () => {
  const events: {
    start?: { msgId: string; durationMs: number; totalSize: number };
    ready?: { msgId: string; bytes: number[]; mimeType: string };
    failed?: string;
  } = {};
  const conv = new Conversation({
    channel: new RecordingChannel(),
    makeWriter: async () => mockWriter().writer,
    callbacks: {
      onVoiceStart: (msgId, durationMs, totalSize) =>
        (events.start = { msgId, durationMs, totalSize }),
      onVoiceReady: (msgId, bytes, mimeType) =>
        (events.ready = { msgId, bytes: Array.from(bytes), mimeType }),
      onVoiceFailed: msgId => (events.failed = msgId),
    },
  });
  const bytes = new Uint8Array([9, 8, 7, 6]);
  await conv.handleIncoming(
    encodeControlFrame({
      type: 'voice-start',
      msgId: 'v1',
      streamId: 0,
      mimeType: 'audio/webm',
      durationMs: 500,
      totalSize: 4,
      ts: 1,
    })
  );
  await conv.handleIncoming(encodeDataFrame(0, 0, bytes));
  await conv.handleIncoming(
    encodeControlFrame({
      type: 'voice-complete',
      msgId: 'v1',
      crc32: crc32(bytes),
    })
  );

  expect(events.start).toMatchObject({
    msgId: 'v1',
    durationMs: 500,
    totalSize: 4,
  });
  expect(events.ready).toMatchObject({
    msgId: 'v1',
    bytes: [9, 8, 7, 6],
    mimeType: 'audio/webm',
  });
  expect(events.failed).toBeUndefined();
});

it('fails an incoming voice message on crc mismatch', async () => {
  let failed: string | undefined;
  let ready = false;
  const conv = new Conversation({
    channel: new RecordingChannel(),
    makeWriter: async () => mockWriter().writer,
    callbacks: {
      onVoiceReady: () => (ready = true),
      onVoiceFailed: msgId => (failed = msgId),
    },
  });
  await conv.handleIncoming(
    encodeControlFrame({
      type: 'voice-start',
      msgId: 'v2',
      streamId: 0,
      mimeType: 'audio/webm',
      durationMs: 1,
      totalSize: 2,
      ts: 1,
    })
  );
  await conv.handleIncoming(encodeDataFrame(0, 0, new Uint8Array([1, 2])));
  await conv.handleIncoming(
    encodeControlFrame({ type: 'voice-complete', msgId: 'v2', crc32: 999999 })
  );
  expect(failed).toBe('v2');
  expect(ready).toBe(false);
});

it('fails in-flight incoming voice when remote closes', async () => {
  let failed: string | undefined;
  const conv = new Conversation({
    channel: new RecordingChannel(),
    makeWriter: async () => mockWriter().writer,
    callbacks: { onVoiceFailed: msgId => (failed = msgId) },
  });
  await conv.handleIncoming(
    encodeControlFrame({
      type: 'voice-start',
      msgId: 'v3',
      streamId: 0,
      mimeType: 'audio/webm',
      durationMs: 1,
      totalSize: 4,
      ts: 1,
    })
  );
  conv.closeRemote();
  expect(failed).toBe('v3');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation.spec`
Expected: FAIL —— 回调从未触发。

- [ ] **Step 3: 实现接收路径**

在 `apps/web/src/core/conversation.ts`：

1）在 `ConversationCallbacks` 接口里追加三个回调：

```ts
  onVoiceStart?: (msgId: string, durationMs: number, totalSize: number) => void;
  onVoiceReady?: (msgId: string, bytes: Uint8Array, mimeType: string) => void;
  onVoiceFailed?: (msgId: string) => void;
```

2）在类字段区（`active` 之后）新增组装器状态与类型。先在 `IncomingState` 接口附近加：

```ts
interface VoiceAssembler {
  msgId: string;
  mimeType: string;
  durationMs: number;
  totalSize: number;
  chunks: Uint8Array[];
}
```

类内字段：

```ts
  private voiceIncoming = new Map<string, VoiceAssembler>(); // msgId -> assembler
  private voiceStreamToMsg = new Map<number, string>(); // streamId -> msgId
```

3）在 `handleIncoming` 的 data 分支最前面（`const tid = ...` 之前）插入语音路由：

```ts
    if (frame.kind === 'data') {
      const vmsg = this.voiceStreamToMsg.get(frame.fileId);
      if (vmsg) {
        const va = this.voiceIncoming.get(vmsg);
        if (va) va.chunks[frame.chunkIndex] = frame.payload.slice();
        return;
      }
      const tid = this.fileIdToTransfer.get(frame.fileId);
      // …原有文件逻辑保持不变…
```

4）在 `switch (msg.type)` 里新增两个 case（放在 `chat` 之后即可）：

```ts
      case 'voice-start':
        this.voiceIncoming.set(msg.msgId, {
          msgId: msg.msgId,
          mimeType: msg.mimeType,
          durationMs: msg.durationMs,
          totalSize: msg.totalSize,
          chunks: [],
        });
        this.voiceStreamToMsg.set(msg.streamId, msg.msgId);
        this.cb.onVoiceStart?.(msg.msgId, msg.durationMs, msg.totalSize);
        return;
      case 'voice-complete': {
        const va = this.voiceIncoming.get(msg.msgId);
        if (!va) return;
        this.voiceIncoming.delete(va.msgId);
        for (const [sid, mid] of this.voiceStreamToMsg)
          if (mid === va.msgId) this.voiceStreamToMsg.delete(sid);
        const bytes = concatChunks(va.chunks, va.totalSize);
        if (crc32(bytes) !== msg.crc32) {
          this.cb.onVoiceFailed?.(va.msgId);
          return;
        }
        this.cb.onVoiceReady?.(va.msgId, bytes, va.mimeType);
        return;
      }
```

5）在 `closeRemote()` 里追加语音清理（`this.active.clear();` 之后）：

```ts
for (const va of this.voiceIncoming.values()) this.cb.onVoiceFailed?.(va.msgId);
this.voiceIncoming.clear();
this.voiceStreamToMsg.clear();
```

6）在文件底部的工具函数区（如 `triggerDownload` 附近）新增：

```ts
function concatChunks(chunks: Uint8Array[], totalSize: number): Uint8Array {
  const out = new Uint8Array(totalSize);
  let offset = 0;
  for (const c of chunks) {
    if (!c) continue;
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation.spec`
Expected: PASS。

- [ ] **Step 5: 接线 Handle 与 startConversation**

在 `ConversationHandle` 接口加：

```ts
sendVoice: (bytes: Uint8Array, mimeType: string, durationMs: number) => {
  item: VoiceItem;
  done: Promise<void>;
};
```

在 `startConversation` 的 `return { … }` 里加：

```ts
    sendVoice: (bytes, mimeType, durationMs) =>
      conv.sendVoice(bytes, mimeType, durationMs),
```

- [ ] **Step 6: 类型检查 + 提交**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: 无错误。

```bash
git add apps/web/src/core/conversation.ts apps/web/src/core/conversation.spec.ts
git commit -m "feat(web): Conversation assembles incoming voice with crc verification"
```

---

### Task 4: store 语音时间线项与 actions

**Files:**

- Modify: `apps/web/src/state/conversation-store.ts`
- Test: `apps/web/src/state/conversation-store.spec.ts`（若不存在则新建）

- [ ] **Step 1: 写失败测试**

新建/追加 `apps/web/src/state/conversation-store.spec.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { useRoomsStore } from './conversation-store';

describe('conversation-store voice', () => {
  beforeEach(() => useRoomsStore.getState().reset());

  it('appendIncomingVoice adds a receiving voice item and bumps unread when inactive', () => {
    const store = useRoomsStore.getState();
    store.addSession('s1', 'room1');
    store.setActive(null);
    store.appendIncomingVoice('s1', 'v1', 3000, 500);
    const item = useRoomsStore.getState().sessions.s1.items[0];
    expect(item).toMatchObject({
      kind: 'voice',
      id: 'v1',
      dir: 'in',
      status: 'receiving',
      durationMs: 3000,
      size: 500,
    });
    expect(useRoomsStore.getState().sessions.s1.unread).toBe(1);
  });

  it('setVoiceReady flips status and stores url', () => {
    const store = useRoomsStore.getState();
    store.addSession('s1', 'room1');
    store.appendOutgoingVoice('s1', 'v2', 1000, 200);
    store.setVoiceReady('s1', 'v2', 'blob:abc');
    const item = useRoomsStore.getState().sessions.s1.items[0];
    expect(item).toMatchObject({
      kind: 'voice',
      status: 'ready',
      url: 'blob:abc',
    });
  });

  it('setVoiceFailed flips status to failed', () => {
    const store = useRoomsStore.getState();
    store.addSession('s1', 'room1');
    store.appendIncomingVoice('s1', 'v3', 1000, 200);
    store.setVoiceFailed('s1', 'v3');
    const item = useRoomsStore.getState().sessions.s1.items[0];
    expect(item).toMatchObject({ kind: 'voice', status: 'failed' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation-store.spec`
Expected: FAIL —— 方法不存在。

- [ ] **Step 3: 实现 store 改动**

在 `apps/web/src/state/conversation-store.ts`：

1）`FileStatus` 之后新增：

```ts
export type VoiceStatus = 'sending' | 'receiving' | 'ready' | 'failed';
```

2）`TimelineItem` 联合追加变体：

```ts
  | {
      kind: 'voice';
      id: string;
      dir: 'out' | 'in';
      status: VoiceStatus;
      durationMs: number;
      size: number;
      url?: string;
      ts: number;
    };
```

3）`RoomsState` 接口追加方法声明：

```ts
  appendOutgoingVoice(id: string, msgId: string, durationMs: number, size: number): void;
  appendIncomingVoice(id: string, msgId: string, durationMs: number, size: number): void;
  setVoiceReady(id: string, msgId: string, url: string): void;
  setVoiceFailed(id: string, msgId: string): void;
```

4）`patchFileItem` 之后新增语音 patch 工具：

```ts
function patchVoiceItem(
  items: TimelineItem[],
  msgId: string,
  patch: Partial<Extract<TimelineItem, { kind: 'voice' }>>
): TimelineItem[] {
  return items.map(it =>
    it.kind === 'voice' && it.id === msgId ? { ...it, ...patch } : it
  );
}
```

5）在 store 实现里（`updateFileProgress` 之后、`reset` 之前）新增四个 action：

```ts
  appendOutgoingVoice: (id, msgId, durationMs, size) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'voice',
            id: msgId,
            dir: 'out',
            status: 'sending',
            durationMs,
            size,
            ts: Date.now(),
          },
        ],
      }))
    ),

  appendIncomingVoice: (id, msgId, durationMs, size) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'voice',
            id: msgId,
            dir: 'in',
            status: 'receiving',
            durationMs,
            size,
            ts: Date.now(),
          },
        ],
        unread: id === state.activeId ? s.unread : s.unread + 1,
      }))
    ),

  setVoiceReady: (id, msgId, url) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: patchVoiceItem(s.items, msgId, { status: 'ready', url }),
      }))
    ),

  setVoiceFailed: (id, msgId) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: patchVoiceItem(s.items, msgId, { status: 'failed' }),
      }))
    ),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation-store.spec`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/state/conversation-store.ts apps/web/src/state/conversation-store.spec.ts
git commit -m "feat(web): voice timeline item and store actions"
```

---

### Task 5: SessionManager 发送/接收接线

**Files:**

- Modify: `apps/web/src/core/session-manager.ts`
- Test: `apps/web/src/core/session-manager.spec.ts`

- [ ] **Step 1: 写失败测试**

先看 `session-manager.spec.ts` 现有的 fake store / fake start 构造方式并复用。追加用例：

```ts
it('sendVoice appends outgoing voice then marks it ready', async () => {
  const calls: string[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>(r => (resolveDone = r));
  const store = makeStore(calls); // 复用本 spec 既有的 store 工厂；若无则见下方说明
  const handle = {
    conversation: {} as never,
    sendText: () => ({ id: 'x', dir: 'out' as const, text: '', ts: 0 }),
    sendFiles: () => ({ transferId: 't', entries: [], totalSize: 0 }),
    sendVoice: () => ({
      item: { id: 'v1', dir: 'out' as const, durationMs: 1000, size: 3, ts: 0 },
      done,
    }),
    acceptTransfer: async () => {},
    rejectTransfer: () => {},
    close: () => {},
  };
  const mgr = new SessionManager({
    store,
    start: () => handle,
  });
  const id = mgr.create();
  const blob = {
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as Blob;
  await mgr.sendVoice(id, blob, 'audio/webm', 1000);
  expect(calls).toContain('appendOutgoingVoice:v1');
  resolveDone();
  await done;
  await Promise.resolve();
  expect(calls).toContain('setVoiceReady:v1');
});
```

> 说明：若该 spec 没有共享的 store 工厂，按文件里已有的 mock store 形态扩展——给 mock store 增加 `appendOutgoingVoice`/`appendIncomingVoice`/`setVoiceReady`/`setVoiceFailed`，各自把 `名称:msgId` push 进 `calls`，并补齐其余既有方法为 no-op。`URL.createObjectURL` 在 jsdom 下可用；若报错，在该用例前加 `globalThis.URL.createObjectURL = () => 'blob:test';`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- session-manager.spec`
Expected: FAIL —— `mgr.sendVoice is not a function` 且 store 接口缺方法。

- [ ] **Step 3: 实现 SessionManager 改动**

在 `apps/web/src/core/session-manager.ts`：

1）`SessionStore` 接口追加：

```ts
  appendOutgoingVoice(id: string, msgId: string, durationMs: number, size: number): void;
  appendIncomingVoice(id: string, msgId: string, durationMs: number, size: number): void;
  setVoiceReady(id: string, msgId: string, url: string): void;
  setVoiceFailed(id: string, msgId: string): void;
```

2）新增 `sendVoice` 方法（放在 `sendFiles` 之后）：

```ts
  async sendVoice(
    id: string,
    blob: Blob,
    mimeType: string,
    durationMs: number
  ): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) return;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch {
      return;
    }
    const { item, done } = handle.sendVoice(bytes, mimeType, durationMs);
    this.store.appendOutgoingVoice(id, item.id, item.durationMs, item.size);
    done
      .then(() => {
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        this.store.setVoiceReady(id, item.id, url);
      })
      .catch(() => this.store.setVoiceFailed(id, item.id));
  }
```

3）在 `callbacks(id)` 返回对象里追加接收回调：

```ts
      onVoiceStart: (msgId, durationMs, totalSize) =>
        this.store.appendIncomingVoice(id, msgId, durationMs, totalSize),
      onVoiceReady: (msgId, bytes, mimeType) =>
        this.store.setVoiceReady(
          id,
          msgId,
          URL.createObjectURL(new Blob([bytes], { type: mimeType }))
        ),
      onVoiceFailed: msgId => this.store.setVoiceFailed(id, msgId),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- session-manager.spec`
Expected: PASS。

- [ ] **Step 5: 类型检查 + 提交**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: 无错误（store 实现 Task 4 已满足接口）。

```bash
git add apps/web/src/core/session-manager.ts apps/web/src/core/session-manager.spec.ts
git commit -m "feat(web): SessionManager voice send/receive wiring"
```

---

### Task 6: 录音封装 voice-recorder.ts

**Files:**

- Create: `apps/web/src/core/voice-recorder.ts`
- Test: `apps/web/src/core/voice-recorder.spec.ts`

- [ ] **Step 1: 写失败测试**

`apps/web/src/core/voice-recorder.spec.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isVoiceSupported,
  pickMimeType,
  VoiceRecorder,
} from './voice-recorder';

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}
class FakeMediaRecorder {
  static supported = new Set(['audio/webm;codecs=opus']);
  static isTypeSupported(t: string) {
    return FakeMediaRecorder.supported.has(t);
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  constructor(_s: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? '';
  }
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    this.onstop?.();
  }
}

function install() {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => new FakeStream() },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('voice-recorder', () => {
  it('pickMimeType prefers opus webm', () => {
    install();
    expect(pickMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('isVoiceSupported reflects API availability', () => {
    install();
    expect(isVoiceSupported()).toBe(true);
  });

  it('records then stops, returning a blob and releasing tracks', async () => {
    install();
    const rec = new VoiceRecorder();
    const stream = new FakeStream();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: async () => stream },
    });
    await rec.start();
    const result = await rec.stop();
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.mimeType).toContain('audio/webm');
    expect(stream.getTracks()[0].stopped).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- voice-recorder.spec`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 voice-recorder.ts**

```ts
import { MAX_VOICE_DURATION_MS } from '@peerlink/protocol';

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
];

/** 选最佳受支持的录音 mimeType；都不支持返回 undefined（用浏览器默认）。 */
export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
}

/** 当前环境是否支持语音录制。 */
export function isVoiceSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** 单条语音录制：start → stop/cancel。60 秒自动停止。 */
export class VoiceRecorder {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mimeType = '';
  private capTimer?: ReturnType<typeof setTimeout>;
  private settle?: (r: RecordingResult) => void;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = pickMimeType();
    this.recorder = type
      ? new MediaRecorder(this.stream, { mimeType: type })
      : new MediaRecorder(this.stream);
    this.mimeType = this.recorder.mimeType || type || 'audio/webm';
    this.chunks = [];
    this.recorder.ondataavailable = e => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => this.finalize();
    this.startedAt = Date.now();
    this.recorder.start();
    this.capTimer = setTimeout(() => {
      void this.stop().catch(() => {});
    }, MAX_VOICE_DURATION_MS);
  }

  stop(): Promise<RecordingResult> {
    return new Promise((resolve, reject) => {
      if (!this.recorder) {
        reject(new Error('not recording'));
        return;
      }
      this.settle = resolve;
      this.clearCap();
      this.recorder.stop();
    });
  }

  cancel(): void {
    this.clearCap();
    this.settle = undefined;
    try {
      this.recorder?.stop();
    } catch {
      /* 已停止则忽略 */
    }
    this.recorder = undefined;
    this.chunks = [];
    this.releaseStream();
  }

  private finalize(): void {
    const durationMs = Date.now() - this.startedAt;
    const blob = new Blob(this.chunks, { type: this.mimeType });
    this.releaseStream();
    const settle = this.settle;
    this.settle = undefined;
    this.recorder = undefined;
    settle?.({ blob, mimeType: this.mimeType, durationMs });
  }

  private clearCap(): void {
    if (this.capTimer !== undefined) {
      clearTimeout(this.capTimer);
      this.capTimer = undefined;
    }
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = undefined;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- voice-recorder.spec`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/voice-recorder.ts apps/web/src/core/voice-recorder.spec.ts
git commit -m "feat(web): MediaRecorder voice-recorder wrapper"
```

---

### Task 7: VoiceBubble 组件

**Files:**

- Create: `apps/web/src/features/chat/VoiceBubble.tsx`
- Test: `apps/web/src/features/chat/VoiceBubble.spec.tsx`

- [ ] **Step 1: 写失败测试**

参考同目录 `FileBubble`/`TextBubble` 是否有 spec 及其 render 工具（`@testing-library/react`）。`VoiceBubble.spec.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TimelineItem } from '@/state/conversation-store';

import { VoiceBubble } from './VoiceBubble';

type Voice = Extract<TimelineItem, { kind: 'voice' }>;

function voice(partial: Partial<Voice>): Voice {
  return {
    kind: 'voice',
    id: 'v1',
    dir: 'in',
    status: 'ready',
    durationMs: 5000,
    size: 100,
    url: 'blob:x',
    ts: 0,
    ...partial,
  };
}

describe('VoiceBubble', () => {
  it('shows formatted duration', () => {
    render(<VoiceBubble item={voice({ durationMs: 65000 })} />);
    expect(screen.getByText('1:05')).toBeInTheDocument();
  });

  it('disables play when not ready', () => {
    render(
      <VoiceBubble item={voice({ status: 'receiving', url: undefined })} />
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders a failed state', () => {
    render(<VoiceBubble item={voice({ status: 'failed', url: undefined })} />);
    expect(screen.getByText(/失败/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- VoiceBubble.spec`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现 VoiceBubble.tsx**

```tsx
import { useRef, useState } from 'react';

import { AlertCircle, Loader2, Pause, Play } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { TimelineItem } from '@/state/conversation-store';

type Voice = Extract<TimelineItem, { kind: 'voice' }>;

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceBubble({ item }: { item: Voice }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const out = item.dir === 'out';
  const ready = item.status === 'ready' && !!item.url;
  const failed = item.status === 'failed';

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-2xl px-3.5 py-2 text-sm',
          out
            ? 'bg-signal text-ink'
            : 'border border-line bg-surface-2/60 text-fg'
        )}
      >
        {failed ? (
          <span className="flex items-center gap-1.5 text-fg-muted">
            <AlertCircle className="size-4" /> 语音失败
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={toggle}
              disabled={!ready}
              aria-label={playing ? '暂停' : '播放'}
              className="flex size-8 items-center justify-center rounded-full bg-black/10 disabled:opacity-50"
            >
              {!ready ? (
                <Loader2 className="size-4 animate-spin" />
              ) : playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </button>
            <span className="tabular-nums">
              {formatDuration(item.durationMs)}
            </span>
            {ready && (
              <audio
                ref={audioRef}
                src={item.url}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className="hidden"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- VoiceBubble.spec`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/chat/VoiceBubble.tsx apps/web/src/features/chat/VoiceBubble.spec.tsx
git commit -m "feat(web): VoiceBubble playback component"
```

---

### Task 8: useVoiceRecorder React hook

**Files:**

- Create: `apps/web/src/features/chat/use-voice-recorder.ts`
- Test: `apps/web/src/features/chat/use-voice-recorder.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useVoiceRecorder } from './use-voice-recorder';

const startMock = vi.fn(async () => {});
const stopMock = vi.fn(async () => ({
  blob: new Blob([new Uint8Array([1])]),
  mimeType: 'audio/webm',
  durationMs: 1200,
}));
const cancelMock = vi.fn();

vi.mock('@/core/voice-recorder', () => ({
  isVoiceSupported: () => true,
  VoiceRecorder: class {
    start = startMock;
    stop = stopMock;
    cancel = cancelMock;
  },
}));

describe('useVoiceRecorder', () => {
  it('starts and stops, delivering the recording', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder(onComplete));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.recording).toBe(true);
    await act(async () => {
      await result.current.stop();
    });
    expect(stopMock).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(
      expect.any(Blob),
      'audio/webm',
      1200
    );
    expect(result.current.recording).toBe(false);
  });

  it('cancel discards the recording', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder(onComplete));
    await act(async () => {
      await result.current.start();
    });
    act(() => result.current.cancel());
    expect(cancelMock).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- use-voice-recorder.spec`
Expected: FAIL —— hook 不存在。

- [ ] **Step 3: 实现 hook**

```ts
import { useCallback, useRef, useState } from 'react';

import { toast } from 'sonner';

import { isVoiceSupported, VoiceRecorder } from '@/core/voice-recorder';

export function useVoiceRecorder(
  onComplete: (blob: Blob, mimeType: string, durationMs: number) => void
) {
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    const rec = new VoiceRecorder();
    recorderRef.current = rec;
    try {
      await rec.start();
      setRecording(true);
    } catch {
      recorderRef.current = null;
      setRecording(false);
      toast.error('无法访问麦克风，请检查权限');
    }
  }, []);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecording(false);
    try {
      const result = await rec.stop();
      if (result.blob.size > 0) {
        onComplete(result.blob, result.mimeType, result.durationMs);
      }
    } catch {
      /* 录音异常：丢弃 */
    }
  }, [onComplete]);

  const cancel = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    rec?.cancel();
  }, []);

  return { supported: isVoiceSupported(), recording, start, stop, cancel };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- use-voice-recorder.spec`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/chat/use-voice-recorder.ts apps/web/src/features/chat/use-voice-recorder.spec.ts
git commit -m "feat(web): useVoiceRecorder hook"
```

---

### Task 9: Composer 麦克风按钮与录音态

**Files:**

- Modify: `apps/web/src/features/chat/Composer.tsx`
- Test: `apps/web/src/features/chat/Composer.spec.tsx`（若不存在则新建）

**交互：** 桌面（`matchMedia('(pointer: coarse)')` 为 false）点击切换录音；移动（coarse）按住录音、松手发送。两端统一用 `useVoiceRecorder`，差异仅在事件绑定。

- [ ] **Step 1: 写失败测试**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';

const start = vi.fn(async () => {});
const stop = vi.fn(async () => {});
const cancel = vi.fn();
let recording = false;

vi.mock('./use-voice-recorder', () => ({
  useVoiceRecorder: () => ({ supported: true, recording, start, stop, cancel }),
}));

beforeEach(() => {
  recording = false;
  start.mockClear();
  stop.mockClear();
  vi.stubGlobal('matchMedia', () => ({ matches: false }) as MediaQueryList);
});

describe('Composer voice', () => {
  const noop = () => {};

  it('shows a mic button when not typing', () => {
    render(
      <Composer
        disabled={false}
        onSendText={noop}
        onSendFiles={noop}
        onSendVoice={noop}
      />
    );
    expect(screen.getByLabelText('录音')).toBeInTheDocument();
  });

  it('desktop click starts recording', () => {
    render(
      <Composer
        disabled={false}
        onSendText={noop}
        onSendFiles={noop}
        onSendVoice={noop}
      />
    );
    fireEvent.click(screen.getByLabelText('录音'));
    expect(start).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- Composer.spec`
Expected: FAIL —— `onSendVoice` prop / 录音按钮 不存在。

- [ ] **Step 3: 实现 Composer 改动**

在 `apps/web/src/features/chat/Composer.tsx`：

1）import 追加：

```ts
import { Folder, Mic, Paperclip, Send, Square, X } from 'lucide-react';

import { useVoiceRecorder } from './use-voice-recorder';
```

2）props 增加 `onSendVoice`：

```ts
export function Composer({
  disabled,
  onSendText,
  onSendFiles,
  onSendVoice,
}: {
  disabled: boolean;
  onSendText: (text: string) => void;
  onSendFiles: (files: File[]) => void;
  onSendVoice: (blob: Blob, mimeType: string, durationMs: number) => void;
}) {
```

3）组件体内、`const [text, setText] = useState('')` 之后：

```ts
const { supported, recording, start, stop, cancel } = useVoiceRecorder(
  (blob, mimeType, durationMs) => onSendVoice(blob, mimeType, durationMs)
);
const coarse =
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const showMic = supported && text.trim().length === 0;
```

4）录音中时，渲染录音条替换输入区。在 `return (` 的最外层 `<div …>` 内，最前面加一个早返回分支处理录音态——在组件函数体内、`return` 之前插入：

```ts
  if (recording) {
    return (
      <div className="flex items-center gap-3 border-t border-line bg-surface px-3 py-3">
        <button
          type="button"
          onClick={cancel}
          aria-label="取消录音"
          className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:text-fg"
        >
          <X className="size-5" />
        </button>
        <div className="flex flex-1 items-center gap-2 text-sm text-fg-muted">
          <span className="size-2 animate-pulse rounded-full bg-danger" />
          正在录音…
        </div>
        <Button onClick={() => void stop()} aria-label="发送语音">
          <Send className="size-4" />
        </Button>
      </div>
    );
  }
```

> 注：若主题无 `bg-danger` token，用 `bg-signal`。

5）麦克风按钮：在「发送文件夹」`Button` 之后、`<textarea>` 之前插入。桌面点击切换，移动按住：

```tsx
{
  showMic && (
    <Button
      variant="ghost"
      disabled={disabled}
      aria-label="录音"
      onClick={coarse ? undefined : () => void start()}
      onPointerDown={coarse ? () => void start() : undefined}
      onPointerUp={coarse ? () => void stop() : undefined}
      onPointerLeave={coarse && recording ? () => cancel() : undefined}
    >
      <Mic className="size-4" />
    </Button>
  );
}
```

6）原本始终显示的发送按钮，仅在有文本时显示（避免和麦克风并存）。把末尾的发送 `Button` 包一层：

```tsx
{
  text.trim().length > 0 && (
    <Button disabled={disabled} onClick={submit} aria-label="发送">
      <Send className="size-4" />
    </Button>
  );
}
```

> `Square` import 若未用到可删除——本任务最终未用 `Square`，请勿保留未使用导入（lint 报错）。改成：`import { Folder, Mic, Paperclip, Send, X } from 'lucide-react';`

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- Composer.spec`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/chat/Composer.tsx apps/web/src/features/chat/Composer.spec.tsx
git commit -m "feat(web): mic button and recording bar in Composer"
```

---

### Task 10: 接入 Timeline 与 ConversationView

**Files:**

- Modify: `apps/web/src/features/chat/Timeline.tsx`
- Modify: `apps/web/src/features/chat/ConversationView.tsx`

- [ ] **Step 1: Timeline 渲染 VoiceBubble**

在 `apps/web/src/features/chat/Timeline.tsx`：

1）import 追加 `import { VoiceBubble } from './VoiceBubble';`

2）把 `items.map` 的三元改成按 kind 分发：

```tsx
{
  items.map(item =>
    item.kind === 'text' ? (
      <TextBubble key={item.id} dir={item.dir} text={item.text} />
    ) : item.kind === 'voice' ? (
      <VoiceBubble key={item.id} item={item} />
    ) : (
      <FileBubble
        key={item.id}
        item={item}
        unsupportedReason={unsupportedReason(item)}
        onAccept={() => onAccept(item.id)}
        onReject={() => onReject(item.id)}
      />
    )
  );
}
```

> 注意：`unsupportedReason(item)` 现在签名要求 `item` 为 file 变体。因为已先用 `item.kind === 'voice'` 排除了 voice，进入 `else` 分支时 TS 仍把 item 收窄为 `file`，类型正常。

- [ ] **Step 2: ConversationView 接 sendVoice**

在 `apps/web/src/features/chat/ConversationView.tsx` 的 `<Composer … />` 加一个 prop：

```tsx
<Composer
  disabled={!connected}
  onSendText={text => sessionManager.sendText(activeId, text)}
  onSendFiles={files => sessionManager.sendFiles(activeId, files)}
  onSendVoice={(blob, mimeType, durationMs) =>
    void sessionManager.sendVoice(activeId, blob, mimeType, durationMs)
  }
/>
```

- [ ] **Step 3: 全量校验**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web lint && pnpm --filter @peerlink/web test`
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/features/chat/Timeline.tsx apps/web/src/features/chat/ConversationView.tsx
git commit -m "feat(web): render voice messages and wire Composer.onSendVoice"
```

---

### Task 11: 全量回归与浏览器手测交接

**Files:** 无（验证任务）

- [ ] **Step 1: 全仓校验**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全绿。

- [ ] **Step 2: 启动 dev 交给用户真机手测**

Run: `pnpm dev`（signaling :3001 + web :5173）。

> 容器内服务宿主机 curl 不通；浏览器手测由用户在真实浏览器完成。手测清单：
>
> - 桌面端：点麦克风→录音条→发送，本端出现可播语音气泡；对端时间线出现并能播放。
> - 移动端（或 DevTools 触摸模拟）：按住麦克风录音、松手发送。
> - 拒绝麦克风权限→toast 提示，不崩溃。
> - 录音中切到文本输入→麦克风让位发送按钮。
> - 断连场景：发送中对端离开→气泡标失败。

- [ ] **Step 3: 提交（如手测中有微调）**

```bash
git commit -am "fix(web): voice message手测微调"
```

---

## Self-Review

**Spec 覆盖核对：**

- 协议 voice-start/voice-complete + `MAX_VOICE_DURATION_MS` → Task 1 ✅
- 录音层（mimeType 选择/60s 封顶/轨道释放/拒权错误）→ Task 6 ✅
- 发送（streamId 取自 nextFileId、复用背压、CRC）→ Task 2 ✅
- 接收（voiceStreams 先于 fileIdToTransfer 路由、内存组装、CRC、closeRemote 清理）→ Task 3 ✅
- store voice TimelineItem + actions → Task 4 ✅
- SessionManager sendVoice + object URL + 回调接线 → Task 5 ✅
- UI：Composer 麦克风（桌面/移动交互）→ Task 9；VoiceBubble 各状态 → Task 7；hook → Task 8；Timeline/ConversationView 接线 → Task 10 ✅
- 错误处理（拒权 toast、CRC 失败、断连失败、60s 自停）→ Tasks 6/3/5/8 ✅
- 测试（protocol schema、conversation 发送/接收/CRC/多路复用、recorder mock、UI 冒烟）→ Tasks 1–9 ✅
- 信令零改动 → 计划未触及 signaling 文件 ✅

**类型一致性核对：**

- `sendVoice(bytes, mimeType, durationMs)` 与 `{ item: VoiceItem; done }` 在 Conversation / Handle / startConversation / SessionManager / 测试中一致 ✅
- 回调名 `onVoiceStart/onVoiceReady/onVoiceFailed` 在 Conversation 定义与 SessionManager 消费处一致 ✅
- store action 名 `appendOutgoingVoice/appendIncomingVoice/setVoiceReady/setVoiceFailed` 在 store / SessionStore 接口 / SessionManager 调用 / 测试中一致 ✅
- `VoiceStatus = 'sending'|'receiving'|'ready'|'failed'`，UI 用 `ready`/`failed` 判定一致 ✅

**占位符扫描：** 无 TBD/TODO；每个改码步骤均给出完整代码与确切路径。

**已知非阻塞注意点（实现者留意，非计划缺陷）：**

- Task 9 中 lucide 图标按钮事件 `coarse ? undefined : …` 在 React 上是合法的（传 undefined 即不绑定）；若 `Button` 组件不透传 `onPointerDown` 等原生事件，需在 `Button`（`features/common/ui`）确认其 `...props` 透传，否则改用原生 `<button>`。
- `bg-danger` token 若主题不存在，回退 `bg-signal`（Task 9 已注明）。
