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
    sendVoice: () => ({
      item: { id: 'v', dir: 'out', durationMs: 0, size: 0, ts: 0 },
      done: Promise.resolve(),
    }),
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
