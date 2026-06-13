import { describe, expect, it, vi } from 'vitest';

import { CALL_GRACE_MS, CALL_RING_TIMEOUT_MS } from '@peerlink/protocol';

import { type CallControl, CallSession } from './call-session';

function harness(isInitiator: boolean) {
  const sent: CallControl[] = [];
  const timers: { fn: () => void; ms: number; h: number }[] = [];
  let nextH = 1;
  let clock = 0;
  const ended: unknown[] = [];
  const errors: string[] = [];
  const incoming: number[] = [];
  const renegotiate = vi.fn().mockResolvedValue(undefined);
  const addLocalAudio = vi.fn();
  const removeLocalAudio = vi.fn();
  const mic = {} as MediaStream;
  const acquireMic = vi.fn().mockResolvedValue(mic);

  const session = new CallSession({
    isInitiator,
    sendControl: m => sent.push(m),
    acquireMic,
    addLocalAudio,
    removeLocalAudio,
    renegotiate,
    genCallId: () => 42,
    now: () => clock,
    setTimeout: (fn, ms) => {
      const h = nextH++;
      timers.push({ fn, ms, h });
      return h;
    },
    clearTimeout: h => {
      const i = timers.findIndex(t => t.h === h);
      if (i >= 0) timers.splice(i, 1);
    },
    callbacks: {
      onStateChange: () => {},
      onIncoming: id => incoming.push(id),
      onError: r => errors.push(r),
      onEnded: r => ended.push(r),
    },
  });

  return {
    session,
    sent,
    ended,
    errors,
    incoming,
    renegotiate,
    addLocalAudio,
    removeLocalAudio,
    acquireMic,
    mic,
    advance(ms: number) {
      clock += ms;
      const due = timers.filter(t => t.ms <= ms);
      for (const t of due) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
    get state() {
      return session.state;
    },
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('CallSession outgoing (caller = initiator)', () => {
  it('dial acquires mic, adds track, sends invite, goes dialing', async () => {
    const h = harness(true);
    await h.session.dial();
    expect(h.acquireMic).toHaveBeenCalled();
    expect(h.addLocalAudio).toHaveBeenCalledWith(h.mic);
    expect(h.sent).toContainEqual({ type: 'call-invite', callId: 42, ts: 0 });
    expect(h.state).toBe('dialing');
  });

  it('remote accept -> connecting -> renegotiate (initiator)', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    expect(h.state).toBe('connecting');
    expect(h.renegotiate).toHaveBeenCalled();
  });

  it('remote track -> active', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    expect(h.state).toBe('active');
  });

  it('ring timeout sends call-end timeout and records missed-out', async () => {
    const h = harness(true);
    await h.session.dial();
    h.advance(CALL_RING_TIMEOUT_MS);
    expect(h.sent).toContainEqual({
      type: 'call-end',
      callId: 42,
      reason: 'timeout',
    });
    expect(h.state).toBe('idle');
    expect(h.removeLocalAudio).toHaveBeenCalled();
  });

  it('remote reject busy -> idle + onError(busy)', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-reject', callId: 42, reason: 'busy' });
    expect(h.errors).toContain('busy');
    expect(h.state).toBe('idle');
  });

  it('local mic failure does not send invite', async () => {
    const h = harness(true);
    h.acquireMic.mockRejectedValueOnce(
      Object.assign(new Error('x'), { reason: 'no-mic' })
    );
    await h.session.dial();
    expect(h.sent).toHaveLength(0);
    expect(h.errors).toContain('no-mic');
    expect(h.state).toBe('idle');
  });
});

describe('CallSession incoming', () => {
  it('invite while idle -> ringing + onIncoming', () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    expect(h.state).toBe('ringing');
    expect(h.incoming).toContain(9);
  });

  it('busy: invite while active -> auto reject busy, state unchanged', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    h.session.onControl({ type: 'call-invite', callId: 99, ts: 1 });
    expect(h.sent).toContainEqual({
      type: 'call-reject',
      callId: 99,
      reason: 'busy',
    });
    expect(h.state).toBe('active');
  });

  it('accept (responder) sends call-accept and waits (no renegotiate)', async () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    await h.session.accept();
    expect(h.sent).toContainEqual({ type: 'call-accept', callId: 9 });
    expect(h.state).toBe('connecting');
    expect(h.renegotiate).not.toHaveBeenCalled();
  });

  it('accept (initiator) sends call-accept then renegotiates', async () => {
    const h = harness(true);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    await h.session.accept();
    expect(h.sent).toContainEqual({ type: 'call-accept', callId: 9 });
    expect(h.renegotiate).toHaveBeenCalled();
  });

  it('reject sends call-reject declined and records', () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    h.session.reject();
    expect(h.sent).toContainEqual({
      type: 'call-reject',
      callId: 9,
      reason: 'declined',
    });
    expect(h.state).toBe('idle');
  });

  it('accept with mic failure rejects with reason', async () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    h.acquireMic.mockRejectedValueOnce(
      Object.assign(new Error('x'), { reason: 'permission-denied' })
    );
    await h.session.accept();
    expect(h.sent).toContainEqual({
      type: 'call-reject',
      callId: 9,
      reason: 'permission-denied',
    });
    expect(h.state).toBe('idle');
  });
});

describe('CallSession glare (simultaneous dial)', () => {
  it('non-initiator dialing receives invite -> switches to ringing', async () => {
    const h = harness(false);
    await h.session.dial();
    h.session.onControl({ type: 'call-invite', callId: 7, ts: 1 });
    expect(h.state).toBe('ringing');
    expect(h.incoming).toContain(7);
  });

  it('initiator dialing receives invite -> rejects busy, keeps dialing', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-invite', callId: 7, ts: 1 });
    expect(h.sent).toContainEqual({
      type: 'call-reject',
      callId: 7,
      reason: 'busy',
    });
    expect(h.state).toBe('dialing');
  });
});

describe('CallSession hangup / remote end / disconnect', () => {
  it('hangup active sends call-end hangup and records', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    h.session.hangup();
    expect(h.sent).toContainEqual({
      type: 'call-end',
      callId: 42,
      reason: 'hangup',
    });
    expect(h.state).toBe('idle');
    expect(h.removeLocalAudio).toHaveBeenCalled();
  });

  it('remote end while active records duration (out)', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    h.session.onControl({ type: 'call-end', callId: 42, reason: 'hangup' });
    expect(h.state).toBe('idle');
    expect(h.ended.at(-1)).toMatchObject({ dir: 'out' });
  });

  it('remote end while ringing records missed (in)', () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 1 });
    h.session.onControl({ type: 'call-end', callId: 9, reason: 'cancelled' });
    expect(h.state).toBe('idle');
    expect(h.ended.at(-1)).toMatchObject({ dir: 'in', outcome: 'missed' });
  });

  it('disconnect during active -> reconnecting, grace expiry ends call failed', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    h.session.onConnectionState('disconnected');
    expect(h.state).toBe('reconnecting');
    h.advance(CALL_GRACE_MS);
    expect(h.state).toBe('idle');
    expect(h.sent).toContainEqual({
      type: 'call-end',
      callId: 42,
      reason: 'failed',
    });
  });

  it('reconnect within grace -> back to active', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    h.session.onConnectionState('disconnected');
    h.session.onConnectionState('connected');
    expect(h.state).toBe('active');
  });
});

describe('CallSession currentCallId', () => {
  it('is null when idle and a number while dialing', async () => {
    const h = harness(true);
    expect(h.session.currentCallId()).toBeNull();
    await h.session.dial();
    expect(h.session.currentCallId()).toBe(42);
  });
});
