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
    appendOutgoingVoice: vi.fn(),
    appendIncomingVoice: vi.fn(),
    setVoiceReady: vi.fn(),
    setVoiceFailed: vi.fn(),
    setCallState: vi.fn(),
    setCallError: vi.fn(),
    setCallMuted: vi.fn(),
    appendCallRecord: vi.fn(),
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
    dialCall: () => Promise.resolve(),
    acceptCall: () => Promise.resolve(),
    rejectCall: () => {},
    hangupCall: () => {},
    startScreenShare: () => Promise.resolve(),
    stopScreenShare: () => Promise.resolve(),
    setMicEnabled: () => {},
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

  it('sends a voice message: appends outgoing then marks ready when done resolves', async () => {
    const store = makeStore();
    let resolveDone!: () => void;
    const done = new Promise<void>(r => (resolveDone = r));
    const start: Start = () =>
      fakeHandle({
        sendVoice: () => ({
          item: { id: 'vx', dir: 'out', durationMs: 1000, size: 3, ts: 0 },
          done,
        }),
      });
    const mgr = new SessionManager({
      store: store as unknown as SessionStore,
      start,
      genId: () => 'id1',
    });
    const id = mgr.create();
    globalThis.URL.createObjectURL = () => 'blob:test';
    const blob = {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Blob;
    await mgr.sendVoice(id, blob, 'audio/webm', 1000);
    expect(store.appendOutgoingVoice).toHaveBeenCalledWith(
      'id1',
      'vx',
      1000,
      3
    );
    resolveDone();
    await done;
    await Promise.resolve();
    expect(store.setVoiceReady).toHaveBeenCalledWith('id1', 'vx', 'blob:test');
  });

  it('wires incoming voice callbacks to the store', () => {
    const store = makeStore();
    let captured: ConversationCallbacks | undefined;
    const start: Start = (_init, callbacks) => {
      captured = callbacks;
      return fakeHandle();
    };
    const mgr = new SessionManager({
      store: store as unknown as SessionStore,
      start,
      genId: () => 'id1',
    });
    mgr.create();
    globalThis.URL.createObjectURL = () => 'blob:in';
    captured?.onVoiceStart?.('v1', 2000, 500);
    expect(store.appendIncomingVoice).toHaveBeenCalledWith(
      'id1',
      'v1',
      2000,
      500
    );
    captured?.onVoiceReady?.('v1', new Uint8Array([1]), 'audio/webm');
    expect(store.setVoiceReady).toHaveBeenCalledWith('id1', 'v1', 'blob:in');
    captured?.onVoiceFailed?.('v1');
    expect(store.setVoiceFailed).toHaveBeenCalledWith('id1', 'v1');
  });

  it('revokes the voice url if the session was removed before the send completed', async () => {
    const store = makeStore();
    let resolveDone!: () => void;
    const done = new Promise<void>(r => (resolveDone = r));
    const start: Start = () =>
      fakeHandle({
        sendVoice: () => ({
          item: { id: 'vx', dir: 'out', durationMs: 1, size: 3, ts: 0 },
          done,
        }),
      });
    const mgr = new SessionManager({
      store: store as unknown as SessionStore,
      start,
      genId: () => 'id1',
    });
    const id = mgr.create();
    const revoke = vi.fn();
    globalThis.URL.createObjectURL = () => 'blob:gone';
    globalThis.URL.revokeObjectURL = revoke;
    const blob = {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Blob;
    await mgr.sendVoice(id, blob, 'audio/webm', 1);
    mgr.remove(id); // session removed before done resolves
    resolveDone();
    await done;
    await Promise.resolve();
    expect(store.setVoiceReady).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:gone');
  });
});
