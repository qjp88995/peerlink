import { describe, expect, it, vi } from 'vitest';

// 验证 startConversation 的资源释放接线：对端断开时自动关闭 ws + RTCPeerConnection，
// 且与用户手动 close() 之间幂等（只关一次）。SignalingClient / PeerConnection 被 mock
// 成可观测的假实现，因为 startConversation 直接 new 它们、未做依赖注入。

interface PeerOpts {
  iceServers: RTCIceServer[];
  onSignal: (p: object) => void;
  onChannelOpen: (dc: RTCDataChannel) => void;
  onMessage: (bytes: Uint8Array) => void;
  onStateChange: (state: RTCIceConnectionState) => void;
}

const mocks = vi.hoisted(() => {
  const sigs: FakeSignaling[] = [];
  const peers: FakePeer[] = [];

  class FakeSignaling {
    private handlers = new Map<string, (...args: unknown[]) => void>();
    closeCount = 0;
    constructor(_url: string) {
      sigs.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args);
    }
    createRoom() {}
    joinRoom(_roomId: string) {}
    signal(_to: string, _payload: Record<string, unknown>) {}
    close() {
      this.closeCount++;
    }
  }

  class FakePeer {
    closeCount = 0;
    constructor(readonly opts: PeerOpts) {
      peers.push(this);
    }
    startAsInitiator() {
      return Promise.resolve();
    }
    acceptAnswer(_sdp: string) {
      return Promise.resolve();
    }
    acceptOffer(_sdp: string) {
      return Promise.resolve();
    }
    addCandidate(_c: RTCIceCandidateInit) {
      return Promise.resolve();
    }
    close() {
      this.closeCount++;
    }
  }

  return { sigs, peers, FakeSignaling, FakePeer };
});

vi.mock('./signaling-client', () => ({ SignalingClient: mocks.FakeSignaling }));
vi.mock('./peer-connection', () => ({ PeerConnection: mocks.FakePeer }));

import { startConversation } from './conversation';

function makeCallbacks() {
  return {
    onRoom: vi.fn(),
    onConnection: vi.fn(),
    onText: vi.fn(),
    onIncomingFiles: vi.fn(),
    onTransferStart: vi.fn(),
    onProgress: vi.fn(),
    onTransferDone: vi.fn(),
    onTransferFailed: vi.fn(),
    onTransferRejected: vi.fn(),
  };
}

describe('startConversation teardown', () => {
  it('releases the ws and peer connection when the peer disconnects', () => {
    const handle = startConversation({ mode: 'create' }, makeCallbacks());
    const sig = mocks.sigs.at(-1)!;
    sig.emit('open');
    sig.emit('peer-joined', 'peer-x'); // synchronously builds the peer

    const peer = mocks.peers.at(-1)!;
    peer.opts.onStateChange('failed');

    expect(peer.closeCount).toBe(1);
    expect(sig.closeCount).toBe(1);

    // 手动 close 不应重复释放（幂等）
    handle.close();
    expect(peer.closeCount).toBe(1);
    expect(sig.closeCount).toBe(1);
  });

  it('still tears down once when only close() is called', () => {
    const handle = startConversation({ mode: 'create' }, makeCallbacks());
    const sig = mocks.sigs.at(-1)!;
    sig.emit('open');
    sig.emit('peer-joined', 'peer-y');
    const peer = mocks.peers.at(-1)!;

    handle.close();
    expect(peer.closeCount).toBe(1);
    expect(sig.closeCount).toBe(1);
  });
});
