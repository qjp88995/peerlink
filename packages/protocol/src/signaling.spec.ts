import { describe, expect, it } from 'vitest';

import { clientMessageSchema, serverMessageSchema } from './signaling';

describe('clientMessageSchema', () => {
  it('accepts create-room', () => {
    expect(clientMessageSchema.parse({ type: 'create-room' })).toEqual({
      type: 'create-room',
    });
  });

  it('accepts join-room with roomId', () => {
    const msg = { type: 'join-room', roomId: '8423-河马' };
    expect(clientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts a signal message carrying an opaque payload', () => {
    const msg = {
      type: 'signal',
      to: 'peer-2',
      payload: { sdp: 'v=0...' },
    };
    expect(clientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('rejects an unknown type', () => {
    expect(() => clientMessageSchema.parse({ type: 'nope' })).toThrow();
  });
});

describe('serverMessageSchema', () => {
  it('accepts room-created', () => {
    const msg = { type: 'room-created', roomId: '8423-河马' };
    expect(serverMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts lan-peers list', () => {
    const msg = {
      type: 'lan-peers',
      peers: [{ peerId: 'p1', name: '橙色河马' }],
    };
    expect(serverMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts error with code', () => {
    const msg = { type: 'error', code: 'ROOM_NOT_FOUND', message: '房间不存在' };
    expect(serverMessageSchema.parse(msg)).toEqual(msg);
  });
});
