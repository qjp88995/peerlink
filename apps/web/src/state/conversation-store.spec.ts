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

  it('never increments unread for outgoing messages', () => {
    s().addSession('A', null);
    s().addSession('B', null); // B is active, A is in the background
    s().appendText('A', { id: 'm1', dir: 'out', text: 'sent to A', ts: 1 });
    expect(s().sessions.A.unread).toBe(0);
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

describe('conversation-store voice', () => {
  beforeEach(() => s().reset());

  it('appendIncomingVoice adds a receiving voice item and bumps unread when inactive', () => {
    s().addSession('s1', 'room1');
    s().setActive(null);
    s().appendIncomingVoice('s1', 'v1', 3000, 500);
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
    s().addSession('s1', 'room1');
    s().appendOutgoingVoice('s1', 'v2', 1000, 200);
    s().setVoiceReady('s1', 'v2', 'blob:abc');
    const item = useRoomsStore.getState().sessions.s1.items[0];
    expect(item).toMatchObject({
      kind: 'voice',
      status: 'ready',
      url: 'blob:abc',
    });
  });

  it('setVoiceFailed flips status to failed', () => {
    s().addSession('s1', 'room1');
    s().appendIncomingVoice('s1', 'v3', 1000, 200);
    s().setVoiceFailed('s1', 'v3');
    const item = useRoomsStore.getState().sessions.s1.items[0];
    expect(item).toMatchObject({ kind: 'voice', status: 'failed' });
  });
});
