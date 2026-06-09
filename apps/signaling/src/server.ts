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
              result.code === 'ROOM_FULL'
                ? '该房间已被占用'
                : '房间不存在或已失效',
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
          this.send(client.peerId, {
            type: 'peer-joined',
            peerId: target.peerId,
          });
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
    const group = this.lan
      .groupMembers(client.peerId)
      .filter(p => p !== client.peerId);
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
