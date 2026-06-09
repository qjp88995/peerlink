import {
  type ClientMessage,
  serverMessageSchema,
  type SignalErrorCode,
} from '@peerlink/protocol';

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

interface SignalPayload {
  [k: string]: unknown;
}

interface Events {
  open: () => void;
  close: () => void;
  'room-created': (roomId: string) => void;
  'peer-joined': (peerId: string) => void;
  'peer-left': (peerId: string) => void;
  'lan-peers': (peers: { peerId: string; name: string }[]) => void;
  signal: (from: string, payload: SignalPayload) => void;
  error: (code: SignalErrorCode, message: string) => void;
}

type Handlers = { [K in keyof Events]: Set<Events[K]> };

export interface SignalingClientOptions {
  createSocket?: (url: string) => WebSocketLike;
}

export class SignalingClient {
  private ws: WebSocketLike;
  private handlers: Handlers = {
    open: new Set(),
    close: new Set(),
    'room-created': new Set(),
    'peer-joined': new Set(),
    'peer-left': new Set(),
    'lan-peers': new Set(),
    signal: new Set(),
    error: new Set(),
  };

  constructor(url: string, opts: SignalingClientOptions = {}) {
    const create =
      opts.createSocket ??
      ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
    this.ws = create(url);
    this.ws.onopen = () => this.emit('open');
    this.ws.onclose = () => this.emit('close');
    this.ws.onmessage = ev => this.onMessage(ev.data);
  }

  on<K extends keyof Events>(event: K, cb: Events[K]): () => void {
    this.handlers[event].add(cb);
    return () => this.handlers[event].delete(cb);
  }

  createRoom(): void {
    this.send({ type: 'create-room' });
  }
  joinRoom(roomId: string): void {
    this.send({ type: 'join-room', roomId });
  }
  lanInvite(targetPeerId: string): void {
    this.send({ type: 'lan-invite', targetPeerId });
  }
  signal(to: string, payload: SignalPayload): void {
    this.send({ type: 'signal', to, payload } as ClientMessage);
  }
  close(): void {
    this.ws.close();
  }

  private send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  private emit<K extends keyof Events>(
    event: K,
    ...args: Parameters<Events[K]>
  ): void {
    for (const cb of this.handlers[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }

  private onMessage(data: string): void {
    let msg;
    try {
      msg = serverMessageSchema.parse(JSON.parse(data));
    } catch {
      return; // 非法消息忽略
    }
    switch (msg.type) {
      case 'room-created':
        return this.emit('room-created', msg.roomId);
      case 'peer-joined':
        return this.emit('peer-joined', msg.peerId);
      case 'peer-left':
        return this.emit('peer-left', msg.peerId);
      case 'lan-peers':
        return this.emit('lan-peers', msg.peers);
      case 'signal':
        return this.emit('signal', msg.from, msg.payload as SignalPayload);
      case 'error':
        return this.emit('error', msg.code, msg.message);
    }
  }
}
