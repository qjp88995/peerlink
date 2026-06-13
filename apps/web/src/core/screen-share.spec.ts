import { describe, expect, it, vi } from 'vitest';

import { ScreenShare, type ScreenShareDeps } from './screen-share';

function fakeTrack(): MediaStreamTrack {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    kind: 'video',
    stop: vi.fn(),
    addEventListener: vi.fn((t: string, cb: () => void) => {
      (listeners[t] ??= []).push(cb);
    }),
    removeEventListener: vi.fn(),
    dispatch: (t: string) => (listeners[t] ?? []).forEach(cb => cb()),
  } as unknown as MediaStreamTrack & { dispatch: (t: string) => void };
}

function fakeStream(track: MediaStreamTrack): MediaStream {
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function setup(overrides: Partial<ScreenShareDeps> = {}) {
  const track = fakeTrack();
  const calls = {
    sendControl: vi.fn(),
    setScreenTrack: vi.fn(),
    prepareRecvVideo: vi.fn(),
    clearScreenTrack: vi.fn(),
    renegotiate: vi.fn(async () => {}),
    onStateChange: vi.fn(),
    onLocalStream: vi.fn(),
    onError: vi.fn(),
  };
  const deps: ScreenShareDeps = {
    isInitiator: true,
    sendControl: calls.sendControl,
    acquireDisplay: async () => fakeStream(track),
    setScreenTrack: calls.setScreenTrack,
    prepareRecvVideo: calls.prepareRecvVideo,
    clearScreenTrack: calls.clearScreenTrack,
    renegotiate: calls.renegotiate,
    getCallId: () => 9,
    callbacks: {
      onStateChange: calls.onStateChange,
      onLocalStream: calls.onLocalStream,
      onError: calls.onError,
    },
    ...overrides,
  };
  return { ss: new ScreenShare(deps), calls, track };
}

describe('ScreenShare', () => {
  it('initiator start: attach track, renegotiate, send screen-start, state local', async () => {
    const { ss, calls, track } = setup({ isInitiator: true });
    await ss.start();
    expect(calls.setScreenTrack).toHaveBeenCalledWith(track);
    expect(calls.renegotiate).toHaveBeenCalledTimes(1);
    expect(calls.sendControl).toHaveBeenCalledWith({
      type: 'screen-start',
      callId: 9,
    });
    expect(ss.state).toBe('local');
    expect(calls.onLocalStream).toHaveBeenCalled();
  });

  it('non-initiator start: attach + send screen-start but does NOT renegotiate', async () => {
    const { ss, calls } = setup({ isInitiator: false });
    await ss.start();
    expect(calls.setScreenTrack).toHaveBeenCalled();
    expect(calls.sendControl).toHaveBeenCalledWith({
      type: 'screen-start',
      callId: 9,
    });
    expect(calls.renegotiate).not.toHaveBeenCalled();
    expect(ss.state).toBe('local');
  });

  it('initiator receiving screen-start: prepareRecvVideo + renegotiate, state remote', async () => {
    const { ss, calls } = setup({ isInitiator: true });
    await ss.onControl({ type: 'screen-start', callId: 9 });
    expect(calls.prepareRecvVideo).toHaveBeenCalledTimes(1);
    expect(calls.renegotiate).toHaveBeenCalledTimes(1);
    expect(ss.state).toBe('remote');
  });

  it('non-initiator receiving screen-start: just go remote, no renegotiate', async () => {
    const { ss, calls } = setup({ isInitiator: false });
    await ss.onControl({ type: 'screen-start', callId: 9 });
    expect(calls.prepareRecvVideo).not.toHaveBeenCalled();
    expect(calls.renegotiate).not.toHaveBeenCalled();
    expect(ss.state).toBe('remote');
  });

  it('start is a no-op while remote is presenting (guard)', async () => {
    const { ss, calls } = setup();
    await ss.onControl({ type: 'screen-start', callId: 9 }); // state remote
    calls.setScreenTrack.mockClear();
    await ss.start();
    expect(calls.setScreenTrack).not.toHaveBeenCalled();
    expect(ss.state).toBe('remote');
  });

  it('presenter stop: clear track, stop stream, send screen-stop, state none', async () => {
    const { ss, calls, track } = setup({ isInitiator: true });
    await ss.start();
    await ss.stop();
    expect(calls.clearScreenTrack).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(calls.sendControl).toHaveBeenLastCalledWith({
      type: 'screen-stop',
      callId: 9,
    });
    expect(calls.onLocalStream).toHaveBeenLastCalledWith(null);
    expect(ss.state).toBe('none');
  });

  it('initiator receiving screen-stop: clear + renegotiate, state none', async () => {
    const { ss, calls } = setup({ isInitiator: true });
    await ss.onControl({ type: 'screen-start', callId: 9 }); // remote
    calls.renegotiate.mockClear();
    await ss.onControl({ type: 'screen-stop', callId: 9 });
    expect(calls.clearScreenTrack).toHaveBeenCalled();
    expect(calls.renegotiate).toHaveBeenCalledTimes(1);
    expect(ss.state).toBe('none');
  });

  it('native Stop sharing (track ended) auto-stops', async () => {
    const { ss, calls, track } = setup({ isInitiator: true });
    await ss.start();
    (track as unknown as { dispatch: (t: string) => void }).dispatch('ended');
    await Promise.resolve();
    expect(calls.clearScreenTrack).toHaveBeenCalled();
    expect(ss.state).toBe('none');
  });

  it('getDisplayMedia denial → onError, stays none', async () => {
    const err = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    const { ss, calls } = setup({
      acquireDisplay: async () => {
        throw err;
      },
    });
    await ss.start();
    expect(calls.onError).toHaveBeenCalledWith('permission-denied');
    expect(ss.state).toBe('none');
  });

  it('start no-ops when not in a call (callId null)', async () => {
    const { ss, calls } = setup({ getCallId: () => null });
    await ss.start();
    expect(calls.setScreenTrack).not.toHaveBeenCalled();
    expect(ss.state).toBe('none');
  });

  it('dispose while local: stops track, clears, resets — without sending control', async () => {
    const { ss, calls, track } = setup({ isInitiator: true });
    await ss.start();
    calls.sendControl.mockClear();
    ss.dispose();
    expect(track.stop).toHaveBeenCalled();
    expect(calls.clearScreenTrack).toHaveBeenCalled();
    expect(calls.onLocalStream).toHaveBeenLastCalledWith(null);
    expect(calls.sendControl).not.toHaveBeenCalled();
    expect(ss.state).toBe('none');
  });

  it('dispose while none: no-op', () => {
    const { ss, calls } = setup();
    ss.dispose();
    expect(calls.clearScreenTrack).not.toHaveBeenCalled();
    expect(ss.state).toBe('none');
  });
});
