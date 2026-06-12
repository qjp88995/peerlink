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

function richPc() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    createDataChannel: vi.fn(() => ({
      binaryType: '',
      addEventListener: vi.fn(),
    })),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'OFFER' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'Y' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    addTrack: vi.fn((track: MediaStreamTrack) => ({ track })),
    removeTrack: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((type: string, cb: (e: unknown) => void) => {
      (listeners[type] ??= []).push(cb);
    }),
    dispatch(type: string, e: unknown) {
      (listeners[type] ?? []).forEach(cb => cb(e));
    },
  };
}

describe('PeerConnection media', () => {
  it('addLocalAudio adds track and renegotiate emits offer via onSignal', async () => {
    const signals: { sdp?: string }[] = [];
    const pc = richPc();
    const conn = new PeerConnection({
      iceServers: [],
      createPc: () => pc as unknown as RTCPeerConnection,
      onSignal: p => signals.push(p),
    });
    const stream = {
      getAudioTracks: () => [{ kind: 'audio' }],
    } as unknown as MediaStream;
    conn.addLocalAudio(stream);
    expect(pc.addTrack).toHaveBeenCalled();
    await conn.renegotiate();
    expect(signals.some(s => s.sdp === 'OFFER')).toBe(true);
  });

  it('onRemoteTrack fires on track event', () => {
    const tracks: MediaStreamTrack[] = [];
    const pc = richPc();
    new PeerConnection({
      iceServers: [],
      createPc: () => pc as unknown as RTCPeerConnection,
      onRemoteTrack: t => tracks.push(t),
    });
    const track = { kind: 'audio' } as MediaStreamTrack;
    pc.dispatch('track', { track });
    expect(tracks).toContain(track);
  });

  it('removeLocalAudio removes previously added senders', () => {
    const pc = richPc();
    const conn = new PeerConnection({
      iceServers: [],
      createPc: () => pc as unknown as RTCPeerConnection,
    });
    const stream = {
      getAudioTracks: () => [{ kind: 'audio' }],
    } as unknown as MediaStream;
    conn.addLocalAudio(stream);
    conn.removeLocalAudio();
    expect(pc.removeTrack).toHaveBeenCalled();
  });

  it('setMicEnabled toggles track.enabled on senders', () => {
    const pc = richPc();
    const conn = new PeerConnection({
      iceServers: [],
      createPc: () => pc as unknown as RTCPeerConnection,
    });
    const track = { kind: 'audio', enabled: true } as MediaStreamTrack;
    conn.addLocalAudio({
      getAudioTracks: () => [track],
    } as unknown as MediaStream);
    conn.setMicEnabled(false);
    expect(track.enabled).toBe(false);
  });
});
