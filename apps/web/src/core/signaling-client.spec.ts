import { describe, expect, it, vi } from 'vitest';

import { SignalingClient, type WebSocketLike } from './signaling-client';

class MockWS implements WebSocketLike {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 1;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function setup() {
  let ws!: MockWS;
  const client = new SignalingClient('ws://x/signal', {
    createSocket: url => (ws = new MockWS(url)),
  });
  return { client, getWs: () => ws };
}

describe('SignalingClient', () => {
  it('sends a create-room message', () => {
    const { client, getWs } = setup();
    client.createRoom();
    expect(JSON.parse(getWs().sent[0])).toEqual({ type: 'create-room' });
  });

  it('sends join-room with the roomId', () => {
    const { client, getWs } = setup();
    client.joinRoom('8423-河马');
    expect(JSON.parse(getWs().sent[0])).toEqual({
      type: 'join-room',
      roomId: '8423-河马',
    });
  });

  it('emits room-created on a valid incoming message', () => {
    const { client, getWs } = setup();
    const cb = vi.fn();
    client.on('room-created', cb);
    getWs().emit({ type: 'room-created', roomId: 'r1' });
    expect(cb).toHaveBeenCalledWith('r1');
  });

  it('emits signal with from + payload', () => {
    const { client, getWs } = setup();
    const cb = vi.fn();
    client.on('signal', cb);
    getWs().emit({ type: 'signal', from: 'p2', payload: { sdp: 'X' } });
    expect(cb).toHaveBeenCalledWith('p2', { sdp: 'X' });
  });

  it('ignores malformed incoming messages', () => {
    const { client, getWs } = setup();
    const cb = vi.fn();
    client.on('error', cb);
    getWs().emit({ type: 'totally-unknown' });
    expect(cb).not.toHaveBeenCalled();
  });
});
