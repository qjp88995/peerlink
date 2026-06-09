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
