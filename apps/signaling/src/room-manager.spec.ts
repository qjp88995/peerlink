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

  it('reap removes a created room that no one ever joined after ttl', () => {
    const clock = { t: 0 };
    const m = makeManager(clock);
    const id = m.createRoom('alice'); // 仅创建，从未有第二人加入
    clock.t = 999;
    expect(m.reap()).toEqual([]); // ttl 内保留，给口令留出分享时间
    clock.t = 1001;
    expect(m.reap()).toEqual([id]); // 超过 ttl 仍无人加入，回收
  });

  it('does not reap a room a second peer has joined', () => {
    const clock = { t: 0 };
    const m = makeManager(clock);
    const id = m.createRoom('alice');
    m.joinRoom(id, 'bob'); // 已接通
    clock.t = 10_000; // 远超 ttl
    expect(m.reap()).toEqual([]); // 活跃房间不回收
  });
});
