import { describe, expect, it, vi } from 'vitest';

import { PeerConnection } from './peer-connection';

function fakePc() {
  return {
    createDataChannel: vi.fn(() => ({
      binaryType: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'X' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'Y' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    close: vi.fn(),
    addEventListener: vi.fn(),
  };
}

describe('PeerConnection', () => {
  it('passes ICE servers into the underlying RTCPeerConnection', () => {
    const ice = [{ urls: 'stun:x:1' }];
    let received: RTCConfiguration | undefined;
    new PeerConnection({
      iceServers: ice,
      createPc: cfg => {
        received = cfg;
        return fakePc() as unknown as RTCPeerConnection;
      },
    });
    expect(received?.iceServers).toBe(ice);
  });

  it('initiator creates a data channel and an offer', async () => {
    const pc = fakePc();
    const conn = new PeerConnection({
      iceServers: [],
      createPc: () => pc as unknown as RTCPeerConnection,
    });
    await conn.startAsInitiator();
    expect(pc.createDataChannel).toHaveBeenCalled();
    expect(pc.createOffer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalled();
  });
});
