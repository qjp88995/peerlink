# 多会话 IM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 PeerLink 从单会话升级为多会话 IM——左侧会话列表、右侧会话详情，同时维护多条彼此独立的一对一 P2P 会话。

**Architecture:** 走「并行多房间」：一个会话 = 一个房间 = 一条独立 ws + RTCPeerConnection + DataChannel + `Conversation`。Web 端用 `SessionManager` 并行持有 N 个 `ConversationHandle`，store 改为多会话 map。`packages/protocol` 与 `apps/signaling` 一行不改，`core/conversation.ts` 等 P2P 内核原样复用，`startConversation()` 按会话复用、回调绑定 sessionId。改动集中在 state 层与 UI 层。

**Tech Stack:** React 19 + TanStack Router + zustand + Tailwind v4 + sonner + lucide-react，测试 Vitest（jsdom）。

完整背景见 `docs/superpowers/specs/2026-06-10-peerlink-multi-conversation-im-design.md`。

所有命令在 `apps/web` 包内执行：`pnpm --filter @peerlink/web <script>`。

---

## File Structure

**改动**

- `apps/web/src/state/conversation-store.ts` — 单会话 → 多会话 `RoomsState`（`useRoomsStore`）。保留 `TimelineItem` / `FileStatus` 类型导出（`Timeline`/`FileBubble` 继续从此处导入，不动）。
- `apps/web/src/state/conversation-store.spec.ts` — 重写为多会话测试。
- `apps/web/src/routes/__root.tsx` — 由 max-w-md 居中列改为全屏外壳（品牌移入侧栏）。
- `apps/web/src/routes/index.tsx` — 渲染 `Inbox`（不再自动建房）。
- `apps/web/src/routes/r.$roomId.tsx` — 渲染 `Inbox` + 挂载时 `sessionManager.join(roomId)`。

**新增**

- `apps/web/src/core/session-manager.ts` — `SessionManager` 类（依赖注入，持有 handle；core 层纯逻辑）。
- `apps/web/src/core/session-manager.spec.ts` — mock `start`/`store` 验证调用契约。
- `apps/web/src/state/session-manager.ts` — 单例 `sessionManager`，把 `SessionManager` 接到 `useRoomsStore` + sonner toast。
- `apps/web/src/features/chat/conversation-list.helpers.ts` — 侧栏纯展示函数（名称/预览/状态）。
- `apps/web/src/features/chat/conversation-list.helpers.spec.ts` — 纯函数单测。
- `apps/web/src/features/chat/ConversationList.tsx` — 左侧会话列表 + 新建/加入入口。
- `apps/web/src/features/chat/ConversationView.tsx` — 右侧详情（空态 / 分享 / 聊天）。
- `apps/web/src/features/chat/Inbox.tsx` — 两栏外壳。

**删除**

- `apps/web/src/features/chat/ChatRoom.tsx` — 被 `Inbox` + `ConversationView` 取代。

**不动**

- 整个 `packages/protocol`、整个 `apps/signaling`。
- `apps/web/src/core/`：`conversation.ts`、`peer-connection.ts`、`signaling-client.ts`、`channel.ts`、`sender`、`receiver`、`storage`。
- `apps/web/src/features/chat/`：`Timeline.tsx`、`Composer.tsx`、`TextBubble.tsx`、`FileBubble.tsx`。
- `apps/web/src/features/share/RoomShare.tsx`（被 `ConversationView` 复用）。

---

## Task 1: 多会话 store

把单会话 store 重构为按 sessionId 索引的多会话 store。

**Files:**

- Modify: `apps/web/src/state/conversation-store.ts`
- Test: `apps/web/src/state/conversation-store.spec.ts`

- [ ] **Step 1: 重写测试**

替换 `apps/web/src/state/conversation-store.spec.ts` 全文：

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { useRoomsStore } from './conversation-store';

const files = [{ fileId: 0, name: 'a.txt', size: 4, relativePath: 'a.txt' }];

function s() {
  return useRoomsStore.getState();
}

describe('rooms store', () => {
  beforeEach(() => s().reset());

  it('adds a session and makes it active', () => {
    s().addSession('A', null);
    expect(s().order).toEqual(['A']);
    expect(s().activeId).toBe('A');
    expect(s().sessions.A).toMatchObject({
      roomId: null,
      connection: 'connecting',
      items: [],
      unread: 0,
    });
  });

  it('keeps timelines isolated per session', () => {
    s().addSession('A', 'room-a');
    s().addSession('B', 'room-b');
    s().appendText('A', { id: 'm1', dir: 'out', text: 'to A', ts: 1 });
    s().appendText('B', { id: 'm2', dir: 'out', text: 'to B', ts: 2 });
    expect(s().sessions.A.items.map(i => i.id)).toEqual(['m1']);
    expect(s().sessions.B.items.map(i => i.id)).toEqual(['m2']);
  });

  it('increments unread only for non-active sessions', () => {
    s().addSession('A', null); // A is active
    s().addSession('B', null); // B is now active
    s().appendText('A', { id: 'm1', dir: 'in', text: 'hi', ts: 1 });
    expect(s().sessions.A.unread).toBe(1);
    s().appendText('B', { id: 'm2', dir: 'in', text: 'yo', ts: 2 });
    expect(s().sessions.B.unread).toBe(0);
  });

  it('clears unread on setActive', () => {
    s().addSession('A', null);
    s().addSession('B', null);
    s().appendText('A', { id: 'm1', dir: 'in', text: 'hi', ts: 1 });
    expect(s().sessions.A.unread).toBe(1);
    s().setActive('A');
    expect(s().activeId).toBe('A');
    expect(s().sessions.A.unread).toBe(0);
  });

  it('tracks a file transfer per session', () => {
    s().addSession('A', null);
    s().appendOutgoingFiles('A', 'T1', files, 4);
    expect(fileItem('A', 'T1')).toMatchObject({
      status: 'awaiting-accept',
      dir: 'out',
    });
    s().updateFileStatus('A', 'T1', 'transferring');
    s().updateFileProgress('A', 'T1', 4);
    s().updateFileStatus('A', 'T1', 'done');
    expect(fileItem('A', 'T1')).toMatchObject({ status: 'done', sent: 4 });
  });

  it('keeps a session in the list when it disconnects', () => {
    s().addSession('A', 'room-a');
    s().setConnection('A', 'closed');
    expect(s().order).toEqual(['A']);
    expect(s().sessions.A.connection).toBe('closed');
  });

  it('removes a session and clears active when it was active', () => {
    s().addSession('A', null);
    s().removeSession('A');
    expect(s().order).toEqual([]);
    expect(s().sessions.A).toBeUndefined();
    expect(s().activeId).toBeNull();
  });
});

function fileItem(id: string, transferId: string) {
  const item = useRoomsStore
    .getState()
    .sessions[id]?.items.find(i => i.id === transferId);
  if (!item || item.kind !== 'file')
    throw new Error('no file item ' + transferId);
  return item;
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation-store`
Expected: FAIL（`useRoomsStore` 未导出）

- [ ] **Step 3: 重写 store 实现**

替换 `apps/web/src/state/conversation-store.ts` 全文：

```ts
import { create } from 'zustand';

import type { FileEntry } from '@peerlink/protocol';

import type { Connection, TextItem } from '../core/conversation';

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

export interface Session {
  id: string;
  roomId: string | null;
  connection: Connection;
  items: TimelineItem[];
  unread: number;
}

interface RoomsState {
  sessions: Record<string, Session>;
  order: string[];
  activeId: string | null;
  addSession(id: string, roomId: string | null): void;
  removeSession(id: string): void;
  setActive(id: string | null): void;
  setRoom(id: string, roomId: string): void;
  setConnection(id: string, connection: Connection): void;
  appendText(id: string, item: TextItem): void;
  appendOutgoingFiles(
    id: string,
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ): void;
  appendIncomingFiles(
    id: string,
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ): void;
  updateFileStatus(id: string, transferId: string, status: FileStatus): void;
  updateFileProgress(id: string, transferId: string, sent: number): void;
  reset(): void;
}

function patchSession(
  state: RoomsState,
  id: string,
  fn: (s: Session) => Session
): Partial<RoomsState> {
  const session = state.sessions[id];
  if (!session) return {};
  return { sessions: { ...state.sessions, [id]: fn(session) } };
}

function patchFileItem(
  items: TimelineItem[],
  transferId: string,
  patch: Partial<Extract<TimelineItem, { kind: 'file' }>>
): TimelineItem[] {
  return items.map(it =>
    it.kind === 'file' && it.id === transferId ? { ...it, ...patch } : it
  );
}

export const useRoomsStore = create<RoomsState>(set => ({
  sessions: {},
  order: [],
  activeId: null,

  addSession: (id, roomId) =>
    set(state => ({
      sessions: {
        ...state.sessions,
        [id]: { id, roomId, connection: 'connecting', items: [], unread: 0 },
      },
      order: state.order.includes(id) ? state.order : [...state.order, id],
      activeId: id,
    })),

  removeSession: id =>
    set(state => {
      const sessions = { ...state.sessions };
      delete sessions[id];
      return {
        sessions,
        order: state.order.filter(x => x !== id),
        activeId: state.activeId === id ? null : state.activeId,
      };
    }),

  setActive: id =>
    set(state =>
      id === null
        ? { activeId: null }
        : {
            ...patchSession(state, id, s => ({ ...s, unread: 0 })),
            activeId: id,
          }
    ),

  setRoom: (id, roomId) =>
    set(state => patchSession(state, id, s => ({ ...s, roomId }))),

  setConnection: (id, connection) =>
    set(state => patchSession(state, id, s => ({ ...s, connection }))),

  appendText: (id, item) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
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
        unread: id === state.activeId ? s.unread : s.unread + 1,
      }))
    ),

  appendOutgoingFiles: (id, transferId, files, totalSize) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'file',
            id: transferId,
            dir: 'out',
            files,
            totalSize,
            status: 'awaiting-accept',
            sent: 0,
          },
        ],
      }))
    ),

  appendIncomingFiles: (id, transferId, files, totalSize) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'file',
            id: transferId,
            dir: 'in',
            files,
            totalSize,
            status: 'awaiting-accept',
            sent: 0,
          },
        ],
        unread: id === state.activeId ? s.unread : s.unread + 1,
      }))
    ),

  updateFileStatus: (id, transferId, status) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: patchFileItem(s.items, transferId, { status }),
      }))
    ),

  updateFileProgress: (id, transferId, sent) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: patchFileItem(s.items, transferId, { sent }),
      }))
    ),

  reset: () => set({ sessions: {}, order: [], activeId: null }),
}));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation-store`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/state/conversation-store.ts apps/web/src/state/conversation-store.spec.ts
git commit -m "feat(web): multi-session rooms store"
```

---

## Task 2: SessionManager（core，依赖注入）

并行持有多个 `ConversationHandle`，把每条会话的回调绑定到 store。

**Files:**

- Create: `apps/web/src/core/session-manager.ts`
- Test: `apps/web/src/core/session-manager.spec.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/core/session-manager.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';

import type { ConversationCallbacks, ConversationHandle } from './conversation';
import { SessionManager, type SessionStore } from './session-manager';

type Start = (
  init: { mode: 'create' } | { mode: 'join'; roomId: string },
  callbacks: ConversationCallbacks
) => ConversationHandle;

function makeStore() {
  return {
    addSession: vi.fn(),
    removeSession: vi.fn(),
    setActive: vi.fn(),
    setRoom: vi.fn(),
    setConnection: vi.fn(),
    appendText: vi.fn(),
    appendIncomingFiles: vi.fn(),
    appendOutgoingFiles: vi.fn(),
    updateFileStatus: vi.fn(),
    updateFileProgress: vi.fn(),
  };
}

function fakeHandle(
  over: Partial<ConversationHandle> = {}
): ConversationHandle {
  return {
    conversation: undefined as unknown as ConversationHandle['conversation'],
    sendText: (text: string) => ({ id: 'out', dir: 'out', text, ts: 0 }),
    sendFiles: () => ({ transferId: 'T', entries: [], totalSize: 0 }),
    acceptTransfer: () => Promise.resolve(),
    rejectTransfer: () => {},
    close: () => {},
    ...over,
  };
}

describe('SessionManager', () => {
  it('creates a session and wires callbacks to the store', () => {
    const store = makeStore();
    let captured: ConversationCallbacks | undefined;
    const start: Start = (_init, callbacks) => {
      captured = callbacks;
      return fakeHandle();
    };
    let n = 0;
    const mgr = new SessionManager({
      store: store as unknown as SessionStore,
      start,
      genId: () => `id${++n}`,
    });

    const id = mgr.create();
    expect(id).toBe('id1');
    expect(store.addSession).toHaveBeenCalledWith('id1', null);

    captured?.onText?.({ id: 'm1', dir: 'in', text: 'hi', ts: 1 });
    expect(store.appendText).toHaveBeenCalledWith('id1', {
      id: 'm1',
      dir: 'in',
      text: 'hi',
      ts: 1,
    });

    captured?.onConnection?.('connected');
    expect(store.setConnection).toHaveBeenCalledWith('id1', 'connected');
  });

  it('dedupes join by roomId and re-activates', () => {
    const store = makeStore();
    const start: Start = () => fakeHandle();
    let n = 0;
    const mgr = new SessionManager({
      store: store as unknown as SessionStore,
      start,
      genId: () => `id${++n}`,
    });

    const a = mgr.join('ROOM');
    const b = mgr.join('ROOM');
    expect(a).toBe(b);
    expect(store.setActive).toHaveBeenCalledWith(a);
    expect(store.addSession).toHaveBeenCalledTimes(1);
  });

  it('routes sendText through the handle and records the outgoing item', () => {
    const store = makeStore();
    const start: Start = () =>
      fakeHandle({
        sendText: (text: string) => ({ id: 'out1', dir: 'out', text, ts: 5 }),
      });
    const mgr = new SessionManager({
      store: store as unknown as SessionStore,
      start,
      genId: () => 'id1',
    });
    const id = mgr.create();
    mgr.sendText(id, 'hello');
    expect(store.appendText).toHaveBeenCalledWith('id1', {
      id: 'out1',
      dir: 'out',
      text: 'hello',
      ts: 5,
    });
  });

  it('closes the handle and removes the session on remove', () => {
    const store = makeStore();
    const close = vi.fn();
    const start: Start = () => fakeHandle({ close });
    const mgr = new SessionManager({
      store: store as unknown as SessionStore,
      start,
      genId: () => 'id1',
    });
    const id = mgr.create();
    mgr.remove(id);
    expect(close).toHaveBeenCalled();
    expect(store.removeSession).toHaveBeenCalledWith('id1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @peerlink/web test -- session-manager`
Expected: FAIL（`session-manager` 模块不存在）

- [ ] **Step 3: 写实现**

创建 `apps/web/src/core/session-manager.ts`：

```ts
import type { FileEntry } from '@peerlink/protocol';

import {
  type Connection,
  type ConversationCallbacks,
  type ConversationHandle,
  startConversation as defaultStart,
  type TextItem,
} from './conversation';

export interface SessionStore {
  addSession(id: string, roomId: string | null): void;
  removeSession(id: string): void;
  setActive(id: string): void;
  setRoom(id: string, roomId: string): void;
  setConnection(id: string, connection: Connection): void;
  appendText(id: string, item: TextItem): void;
  appendIncomingFiles(
    id: string,
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ): void;
  appendOutgoingFiles(
    id: string,
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ): void;
  updateFileStatus(
    id: string,
    transferId: string,
    status: 'transferring' | 'done' | 'failed' | 'rejected'
  ): void;
  updateFileProgress(id: string, transferId: string, sent: number): void;
}

export interface SessionManagerDeps {
  store: SessionStore;
  start?: typeof defaultStart;
  genId?: () => string;
  onConnectionChange?: (id: string, state: Connection) => void;
}

/** 并行持有多个 P2P 会话，把每条会话的回调路由到 store。 */
export class SessionManager {
  private handles = new Map<string, ConversationHandle>();
  private rooms = new Map<string, string>();
  private store: SessionStore;
  private start: typeof defaultStart;
  private genId: () => string;
  private onConnectionChange?: (id: string, state: Connection) => void;

  constructor(deps: SessionManagerDeps) {
    this.store = deps.store;
    this.start = deps.start ?? defaultStart;
    this.genId = deps.genId ?? (() => crypto.randomUUID());
    this.onConnectionChange = deps.onConnectionChange;
  }

  create(): string {
    const id = this.genId();
    this.store.addSession(id, null);
    this.handles.set(id, this.start({ mode: 'create' }, this.callbacks(id)));
    return id;
  }

  join(roomId: string): string {
    for (const [id, room] of this.rooms) {
      if (room === roomId && this.handles.has(id)) {
        this.store.setActive(id);
        return id;
      }
    }
    const id = this.genId();
    this.rooms.set(id, roomId);
    this.store.addSession(id, roomId);
    this.handles.set(
      id,
      this.start({ mode: 'join', roomId }, this.callbacks(id))
    );
    return id;
  }

  remove(id: string): void {
    this.handles.get(id)?.close();
    this.handles.delete(id);
    this.rooms.delete(id);
    this.store.removeSession(id);
  }

  sendText(id: string, text: string): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    this.store.appendText(id, handle.sendText(text));
  }

  sendFiles(id: string, files: File[]): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    const out = handle.sendFiles(files);
    this.store.appendOutgoingFiles(
      id,
      out.transferId,
      out.entries,
      out.totalSize
    );
  }

  acceptTransfer(id: string, transferId: string): void {
    void this.handles.get(id)?.acceptTransfer(transferId);
  }

  rejectTransfer(id: string, transferId: string): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.rejectTransfer(transferId);
    this.store.updateFileStatus(id, transferId, 'rejected');
  }

  closeAll(): void {
    for (const handle of this.handles.values()) handle.close();
    this.handles.clear();
    this.rooms.clear();
  }

  private callbacks(id: string): ConversationCallbacks {
    return {
      onRoom: roomId => {
        this.rooms.set(id, roomId);
        this.store.setRoom(id, roomId);
      },
      onConnection: state => {
        this.store.setConnection(id, state);
        this.onConnectionChange?.(id, state);
      },
      onText: item => this.store.appendText(id, item),
      onIncomingFiles: (transferId, files, total) =>
        this.store.appendIncomingFiles(id, transferId, files, total),
      onTransferStart: transferId =>
        this.store.updateFileStatus(id, transferId, 'transferring'),
      onProgress: (transferId, sent) =>
        this.store.updateFileProgress(id, transferId, sent),
      onTransferDone: transferId =>
        this.store.updateFileStatus(id, transferId, 'done'),
      onTransferFailed: transferId =>
        this.store.updateFileStatus(id, transferId, 'failed'),
      onTransferRejected: transferId =>
        this.store.updateFileStatus(id, transferId, 'rejected'),
    };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @peerlink/web test -- session-manager`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/session-manager.ts apps/web/src/core/session-manager.spec.ts
git commit -m "feat(web): SessionManager orchestrating parallel P2P sessions"
```

---

## Task 3: SessionManager 单例接线

把 `SessionManager` 接到真实 store 与 sonner toast。

**Files:**

- Create: `apps/web/src/state/session-manager.ts`

- [ ] **Step 1: 写实现**

创建 `apps/web/src/state/session-manager.ts`：

```ts
import { toast } from 'sonner';

import { SessionManager, type SessionStore } from '@/core/session-manager';

import { useRoomsStore } from './conversation-store';

const store: SessionStore = {
  addSession: (id, roomId) => useRoomsStore.getState().addSession(id, roomId),
  removeSession: id => useRoomsStore.getState().removeSession(id),
  setActive: id => useRoomsStore.getState().setActive(id),
  setRoom: (id, roomId) => useRoomsStore.getState().setRoom(id, roomId),
  setConnection: (id, c) => useRoomsStore.getState().setConnection(id, c),
  appendText: (id, item) => useRoomsStore.getState().appendText(id, item),
  appendIncomingFiles: (id, t, files, total) =>
    useRoomsStore.getState().appendIncomingFiles(id, t, files, total),
  appendOutgoingFiles: (id, t, files, total) =>
    useRoomsStore.getState().appendOutgoingFiles(id, t, files, total),
  updateFileStatus: (id, t, s) =>
    useRoomsStore.getState().updateFileStatus(id, t, s),
  updateFileProgress: (id, t, sent) =>
    useRoomsStore.getState().updateFileProgress(id, t, sent),
};

export const sessionManager = new SessionManager({
  store,
  onConnectionChange: (_id, state) => {
    if (state === 'closed') toast.info('对方已离开');
    if (state === 'error') toast.error('连接出错');
  },
});
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: 通过（此文件无类型错误；其余文件待后续任务接入，若有遗留报错属预期，下一步据此推进）

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/state/session-manager.ts
git commit -m "feat(web): wire SessionManager singleton to store and toasts"
```

---

## Task 4: 侧栏展示纯函数

抽出会话名/末条预览/状态语义为纯函数，单测覆盖（不引入 testing-library，沿用项目「纯逻辑 TDD」约定）。

**Files:**

- Create: `apps/web/src/features/chat/conversation-list.helpers.ts`
- Test: `apps/web/src/features/chat/conversation-list.helpers.spec.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/features/chat/conversation-list.helpers.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';

import type { Session } from '@/state/conversation-store';

import {
  lastPreview,
  sessionName,
  statusTone,
} from './conversation-list.helpers';

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'A',
    roomId: 'abc123',
    connection: 'connected',
    items: [],
    unread: 0,
    ...over,
  };
}

describe('conversation-list helpers', () => {
  it('names a session by its room code, falling back when absent', () => {
    expect(sessionName(session({ roomId: 'abc123' }))).toBe('#abc123');
    expect(sessionName(session({ roomId: null }))).toBe('新会话');
  });

  it('previews the last text message', () => {
    expect(
      lastPreview(
        session({
          items: [{ kind: 'text', id: 'm', dir: 'in', text: '你好', ts: 1 }],
        })
      )
    ).toBe('你好');
  });

  it('previews a file by name', () => {
    expect(
      lastPreview(
        session({
          items: [
            {
              kind: 'file',
              id: 'T',
              dir: 'in',
              files: [
                { fileId: 0, name: 'a.png', size: 1, relativePath: 'a.png' },
              ],
              totalSize: 1,
              status: 'awaiting-accept',
              sent: 0,
            },
          ],
        })
      )
    ).toBe('[文件] a.png');
  });

  it('falls back to a status hint when there are no messages', () => {
    expect(lastPreview(session({ items: [], connection: 'waiting' }))).toBe(
      '等待对方加入…'
    );
  });

  it('maps connection to a status tone', () => {
    expect(statusTone('connected')).toBe('live');
    expect(statusTone('waiting')).toBe('pending');
    expect(statusTone('connecting')).toBe('pending');
    expect(statusTone('closed')).toBe('dead');
    expect(statusTone('error')).toBe('dead');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation-list.helpers`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

创建 `apps/web/src/features/chat/conversation-list.helpers.ts`：

```ts
import type { Connection } from '@/core/conversation';
import type { Session } from '@/state/conversation-store';

export function sessionName(session: Session): string {
  return session.roomId ? `#${session.roomId}` : '新会话';
}

export function statusHint(connection: Connection): string {
  switch (connection) {
    case 'waiting':
      return '等待对方加入…';
    case 'connecting':
      return '连接中…';
    case 'connected':
      return '已连接';
    case 'closed':
      return '已断开';
    case 'error':
      return '连接出错';
    default:
      return '';
  }
}

export function lastPreview(session: Session): string {
  const last = session.items[session.items.length - 1];
  if (!last) return statusHint(session.connection);
  if (last.kind === 'text') return last.text;
  const name = last.files[0]?.name ?? '文件';
  return last.files.length > 1
    ? `[文件] ${name} 等 ${last.files.length} 个`
    : `[文件] ${name}`;
}

export type StatusTone = 'live' | 'pending' | 'dead';

export function statusTone(connection: Connection): StatusTone {
  if (connection === 'connected') return 'live';
  if (connection === 'closed' || connection === 'error') return 'dead';
  return 'pending';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation-list.helpers`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/chat/conversation-list.helpers.ts apps/web/src/features/chat/conversation-list.helpers.spec.ts
git commit -m "feat(web): conversation list presentation helpers"
```

---

## Task 5: ConversationList 组件

左侧会话列表 + 顶部「新建会话」+「粘贴链接加入」。

**Files:**

- Create: `apps/web/src/features/chat/ConversationList.tsx`

- [ ] **Step 1: 写实现**

创建 `apps/web/src/features/chat/ConversationList.tsx`：

```tsx
import { useState } from 'react';

import { Plus, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useRoomsStore } from '@/state/conversation-store';
import { sessionManager } from '@/state/session-manager';

import {
  lastPreview,
  sessionName,
  type StatusTone,
  statusTone,
} from './conversation-list.helpers';

const TONE_DOT: Record<StatusTone, string> = {
  live: 'bg-success',
  pending: 'bg-signal',
  dead: 'bg-fg-faint',
};

function parseRoomId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes('/r/')) {
    const tail = trimmed.split('/r/')[1] ?? '';
    const code = tail.split(/[/?#]/)[0];
    return code ? decodeURIComponent(code) : null;
  }
  return trimmed;
}

export function ConversationList() {
  const sessions = useRoomsStore(s => s.sessions);
  const order = useRoomsStore(s => s.order);
  const activeId = useRoomsStore(s => s.activeId);
  const [link, setLink] = useState('');

  function joinFromLink() {
    const roomId = parseRoomId(link);
    if (!roomId) return;
    sessionManager.join(roomId);
    setLink('');
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-display text-lg font-extrabold tracking-tight">
          Peer<span className="text-signal">Link</span>
        </span>
        <button
          onClick={() => sessionManager.create()}
          aria-label="新建会话"
          className="flex size-8 items-center justify-center rounded-lg border border-line text-fg-muted transition-colors hover:border-fg-faint hover:text-fg"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <input
          value={link}
          onChange={e => setLink(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && joinFromLink()}
          placeholder="粘贴邀请链接或口令"
          className="w-full rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-fg-faint"
        />
      </div>

      <ul className="flex-1 overflow-y-auto">
        {order.map(id => {
          const session = sessions[id];
          if (!session) return null;
          const tone = statusTone(session.connection);
          const active = id === activeId;
          return (
            <li key={id}>
              <button
                onClick={() => useRoomsStore.getState().setActive(id)}
                className={cn(
                  'group flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-2/60',
                  active && 'bg-surface-2',
                  tone === 'dead' && 'opacity-50'
                )}
              >
                <span
                  className={cn(
                    'size-2.5 shrink-0 rounded-full',
                    TONE_DOT[tone]
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">
                    {sessionName(session)}
                  </span>
                  <span className="block truncate text-xs text-fg-faint">
                    {lastPreview(session)}
                  </span>
                </span>
                {session.unread > 0 && !active && (
                  <span className="shrink-0 rounded-full bg-signal px-1.5 text-xs font-medium text-surface">
                    {session.unread}
                  </span>
                )}
                <span
                  role="button"
                  aria-label="移除会话"
                  onClick={e => {
                    e.stopPropagation();
                    sessionManager.remove(id);
                  }}
                  className="hidden size-5 shrink-0 items-center justify-center rounded text-fg-faint hover:text-danger group-hover:flex"
                >
                  <X className="size-3.5" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: 本文件无报错（`Inbox`/路由未接入前可能有其它遗留报错，下一任务消除）

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/features/chat/ConversationList.tsx
git commit -m "feat(web): ConversationList sidebar"
```

---

## Task 6: ConversationView 组件

右侧详情：空态 / 等待分享 / 聊天。

**Files:**

- Create: `apps/web/src/features/chat/ConversationView.tsx`

- [ ] **Step 1: 写实现**

创建 `apps/web/src/features/chat/ConversationView.tsx`：

```tsx
import { RoomShare } from '@/features/share/RoomShare';
import { useRoomsStore } from '@/state/conversation-store';
import { sessionManager } from '@/state/session-manager';

import { Composer } from './Composer';
import { Timeline } from './Timeline';

export function ConversationView() {
  const activeId = useRoomsStore(s => s.activeId);
  const session = useRoomsStore(s =>
    s.activeId ? s.sessions[s.activeId] : undefined
  );

  if (!activeId || !session) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 text-center text-sm text-fg-faint">
        点击左上角「+」新建会话，或粘贴邀请链接加入
      </main>
    );
  }

  if (session.connection === 'waiting') {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        {session.roomId ? (
          <div className="w-full max-w-sm">
            <RoomShare roomId={session.roomId} />
          </div>
        ) : (
          <span className="text-sm text-fg-faint">创建房间中…</span>
        )}
      </main>
    );
  }

  const connected = session.connection === 'connected';

  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden">
      <Timeline
        items={session.items}
        onAccept={id => sessionManager.acceptTransfer(activeId, id)}
        onReject={id => sessionManager.rejectTransfer(activeId, id)}
      />
      <Composer
        disabled={!connected}
        onSendText={text => sessionManager.sendText(activeId, text)}
        onSendFiles={files => sessionManager.sendFiles(activeId, files)}
      />
    </main>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/features/chat/ConversationView.tsx
git commit -m "feat(web): ConversationView detail pane"
```

---

## Task 7: Inbox 外壳 + 根布局

两栏外壳，根布局改为全屏。

**Files:**

- Create: `apps/web/src/features/chat/Inbox.tsx`
- Modify: `apps/web/src/routes/__root.tsx`

- [ ] **Step 1: 写 Inbox**

创建 `apps/web/src/features/chat/Inbox.tsx`：

```tsx
import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';

export function Inbox() {
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <ConversationList />
      <ConversationView />
    </div>
  );
}
```

- [ ] **Step 2: 改根布局**

替换 `apps/web/src/routes/__root.tsx` 全文（去掉 max-w-md 居中列与品牌头/尾，品牌已移入侧栏）：

```tsx
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';

export const Route = createRootRoute({
  component: () => (
    <div className="h-dvh">
      <Outlet />

      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-line-bright)',
            color: 'var(--color-fg)',
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
    </div>
  ),
});
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/features/chat/Inbox.tsx apps/web/src/routes/__root.tsx
git commit -m "feat(web): Inbox shell and full-screen root layout"
```

---

## Task 8: 路由接入 + 移除 ChatRoom

`/` 渲染 Inbox（不自动建房）；`/r/$roomId` 渲染 Inbox 并在挂载时 join。

**Files:**

- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/routes/r.$roomId.tsx`
- Delete: `apps/web/src/features/chat/ChatRoom.tsx`

- [ ] **Step 1: 改 index 路由**

替换 `apps/web/src/routes/index.tsx` 全文：

```tsx
import { createFileRoute } from '@tanstack/react-router';

import { Inbox } from '@/features/chat/Inbox';

export const Route = createFileRoute('/')({
  component: Inbox,
});
```

- [ ] **Step 2: 改 join 路由**

替换 `apps/web/src/routes/r.$roomId.tsx` 全文：

```tsx
import { useEffect } from 'react';

import { createFileRoute } from '@tanstack/react-router';

import { Inbox } from '@/features/chat/Inbox';
import { sessionManager } from '@/state/session-manager';

export const Route = createFileRoute('/r/$roomId')({
  component: function JoinRoute() {
    const { roomId } = Route.useParams();
    const decoded = decodeURIComponent(roomId);
    useEffect(() => {
      sessionManager.join(decoded);
    }, [decoded]);
    return <Inbox />;
  },
});
```

> `join` 内部按 roomId 去重，React StrictMode 下挂载两次也只产生一条会话。

- [ ] **Step 3: 删除 ChatRoom**

```bash
git rm apps/web/src/features/chat/ChatRoom.tsx
```

- [ ] **Step 4: 全量类型检查**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS（无 `useConversationStore` / `ChatRoom` 残留引用）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/routes/index.tsx apps/web/src/routes/r.$roomId.tsx
git commit -m "feat(web): route to multi-conversation Inbox, drop ChatRoom"
```

---

## Task 9: 全量校验

**Files:** 无（仅运行校验）

- [ ] **Step 1: 测试 + 类型 + lint + 构建**

Run:

```bash
pnpm --filter @peerlink/web test
pnpm --filter @peerlink/web typecheck
pnpm --filter @peerlink/web lint
pnpm --filter @peerlink/web build
```

Expected: 全部 PASS。

- [ ] **Step 2: 手测（浏览器，由用户执行）**

启动 `pnpm dev`，验证：

1. 打开 `/` → 空态提示；点「+」→ 右侧出现分享面板，列表里新增一条「等待对方加入」会话。
2. 另一浏览器/标签扫码或开 `/r/<roomId>` → 两端接通，列表项变「已连接」绿点。
3. 再点「+」建第二条会话并接通 → 列表两条共存，切换互不串扰，后台会话来消息时显示未读数。
4. 关闭一端 → 对端该会话灰显「已断开」，历史可见；点 × 移除该会话，其余不受影响。
5. 文件收发 accept/reject、进度在对应会话内正常。

- [ ] **Step 3: 更新 execution-progress 记忆**

把本计划完成状态记入记忆（见 `MEMORY.md` 的 execution-progress）。

---

## Self-Review

**Spec 覆盖**

- 并行多房间架构 → Task 2/3（SessionManager 持有多 handle）。✅
- 协议/信令零改动 → 文件清单「不动」+ 无任务触碰 protocol/signaling。✅
- 纯内存阅后即焚 → store 无持久化；`reset()` 仅测试用。✅
- 双向汇入列表（+ 建会话 / 链接加入）→ Task 5（`create`/`join` 入口）+ Task 8（`/r/$roomId` join）。✅
- roomId 短码命名 → Task 4 `sessionName`。✅
- 掉线灰显 + 手动移除 → store「disconnect 保留」用例 + Task 5 × 按钮 + `statusTone='dead'` 置灰。✅
- 后台不卸载、未读 → store unread 逻辑 + Task 5 未读徽标。✅
- 分享面板仅等待中的建会话方可见 → Task 6 `connection==='waiting'` 分支（join 方永不进入 waiting）。✅
- 单条会话错误隔离 → SessionManager 回调按 id 路由 + Task 3 toast。✅
- 测试策略（store TDD / SessionManager mock / 侧栏纯函数）→ Task 1/2/4。✅

**占位符扫描**：无 TBD/TODO，所有步骤含完整代码或确切命令。✅

**类型/签名一致性**

- store 方法签名（`appendOutgoingFiles(id, transferId, files, totalSize)` 等）在 Task 1 定义，Task 2 `SessionStore` 端口与 Task 3 单例适配器一致。✅
- `useRoomsStore`（非旧 `useConversationStore`）在 Task 1 起全程统一。✅
- `TimelineItem` / `FileStatus` 仍由 `conversation-store.ts` 导出，`Timeline`/`FileBubble` 导入路径不变。✅
- `Connection` 状态机（`connecting`/`waiting`/`connected`/`closed`/`error`）与现有 `core/conversation.ts` 枚举对齐，无需扩展。✅
- `sessionManager` 单例同时被 Task 5（按钮）、Task 6（动作）、Task 8（路由）引用，均来自 `@/state/session-manager`。✅

> 与 spec 的有意微调：(1) store 用统一 `addSession(id, roomId|null)` 取代 spec 列出的 `createSession`/`joinSession`，DRY；(2) `clearUnread` 合并进 `setActive`；(3) 放弃 store 内 `shareUrl` 字段，分享链接由 `RoomShare` 从 `roomId` 派生。均不影响外部行为。
