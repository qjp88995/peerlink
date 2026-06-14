import type { ServerMessage } from '@peerlink/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { loadConfig } from './config';
import { SignalingServer } from './server';

let server: SignalingServer;
let url: string;

const silentLogger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
} as never;

/** 用给定的配置覆盖重启服务，返回最终配置。 */
async function restart(
  overrides: Partial<ReturnType<typeof loadConfig>> = {}
): Promise<ReturnType<typeof loadConfig>> {
  if (server) await server.close();
  const config = {
    ...loadConfig(),
    port: 0,
    reapIntervalMs: 60_000,
    ...overrides,
  };
  server = new SignalingServer(config, silentLogger);
  await server.listen();
  url = `ws://127.0.0.1:${server.port}${config.path}`;
  return config;
}

beforeEach(async () => {
  await restart();
});

afterEach(async () => {
  await server.close();
});

function connect(): Promise<WebSocket> {
  const ws = new WebSocket(url);
  return new Promise(resolve => ws.on('open', () => resolve(ws)));
}

/** 等待下一条满足 predicate 的服务端消息。 */
function next(
  ws: WebSocket,
  predicate: (m: ServerMessage) => boolean
): Promise<ServerMessage> {
  return new Promise(resolve => {
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (predicate(msg)) {
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('SignalingServer', () => {
  it('creates a room and relays signal between two peers', async () => {
    const alice = await connect();
    const created = next(alice, m => m.type === 'room-created');
    alice.send(JSON.stringify({ type: 'create-room' }));
    const room = (await created) as Extract<
      ServerMessage,
      { type: 'room-created' }
    >;

    const bob = await connect();
    // alice（先到者）应收到 peer-joined
    const joined = next(alice, m => m.type === 'peer-joined');
    bob.send(JSON.stringify({ type: 'join-room', roomId: room.roomId }));
    const peerJoined = (await joined) as Extract<
      ServerMessage,
      { type: 'peer-joined' }
    >;
    expect(peerJoined.peerId).toBeTruthy();

    // alice 向 bob 转发一个 offer
    const bobSignal = next(bob, m => m.type === 'signal');
    alice.send(
      JSON.stringify({
        type: 'signal',
        to: peerJoined.peerId,
        payload: { sdp: 'OFFER' },
      })
    );
    const sig = (await bobSignal) as Extract<ServerMessage, { type: 'signal' }>;
    expect(sig.payload).toEqual({ sdp: 'OFFER' });

    alice.close();
    bob.close();
  });

  it('rejects joining a missing room', async () => {
    const ws = await connect();
    const err = next(ws, m => m.type === 'error');
    ws.send(JSON.stringify({ type: 'join-room', roomId: 'ghost' }));
    const e = (await err) as Extract<ServerMessage, { type: 'error' }>;
    expect(e.code).toBe('ROOM_NOT_FOUND');
    ws.close();
  });

  it('returns BAD_MESSAGE for unparseable input', async () => {
    const ws = await connect();
    const err = next(ws, m => m.type === 'error');
    ws.send('not json');
    const e = (await err) as Extract<ServerMessage, { type: 'error' }>;
    expect(e.code).toBe('BAD_MESSAGE');
    ws.close();
  });

  it('closes a connection that exceeds maxPayload', async () => {
    const config = await restart({ maxPayloadBytes: 64 });
    expect(config.maxPayloadBytes).toBe(64);
    const ws = await connect();
    const closed = new Promise<number>(resolve =>
      ws.on('close', code => resolve(code))
    );
    ws.send(
      JSON.stringify({
        type: 'signal',
        to: 'x',
        payload: { sdp: 'A'.repeat(500) },
      })
    );
    expect(await closed).toBe(1009); // RFC6455 Message Too Big
  });

  it('rejects a disallowed Origin when an allowlist is set', async () => {
    await restart({ allowedOrigins: ['https://peer.example'] });
    const ws = new WebSocket(url, {
      headers: { origin: 'https://evil.example' },
    });
    const outcome = await new Promise<string>(resolve => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('rejected'));
      ws.on('unexpected-response', () => resolve('rejected'));
    });
    expect(outcome).toBe('rejected');
  });

  it('allows a permitted Origin', async () => {
    await restart({ allowedOrigins: ['https://peer.example'] });
    const ws = new WebSocket(url, {
      headers: { origin: 'https://peer.example' },
    });
    const outcome = await new Promise<string>(resolve => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('rejected'));
    });
    expect(outcome).toBe('open');
    ws.close();
  });

  it('terminates a connection that stops answering pings', async () => {
    await restart({ heartbeatIntervalMs: 40 });
    const ws = new WebSocket(url, { autoPong: false });
    await new Promise(resolve => ws.on('open', resolve));
    const closed = await new Promise<boolean>(resolve => {
      ws.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 1000);
    });
    expect(closed).toBe(true);
  });

  it('notifies the remaining peer when the other disconnects', async () => {
    const alice = await connect();
    const created = next(alice, m => m.type === 'room-created');
    alice.send(JSON.stringify({ type: 'create-room' }));
    const room = (await created) as Extract<
      ServerMessage,
      { type: 'room-created' }
    >;
    const bob = await connect();
    const joined = next(alice, m => m.type === 'peer-joined');
    bob.send(JSON.stringify({ type: 'join-room', roomId: room.roomId }));
    await joined;

    const left = next(alice, m => m.type === 'peer-left');
    bob.close();
    const l = (await left) as Extract<ServerMessage, { type: 'peer-left' }>;
    expect(l.peerId).toBeTruthy();
    alice.close();
  });
});
