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
