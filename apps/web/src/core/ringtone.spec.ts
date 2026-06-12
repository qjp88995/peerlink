import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Ringtone } from './ringtone';

function fakeContext() {
  const oscillators: { start: ReturnType<typeof vi.fn> }[] = [];
  return {
    currentTime: 0,
    destination: {},
    createGain: () => ({
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    }),
    createOscillator: () => {
      const o = {
        type: '',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(o);
      return o;
    },
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    _oscillators: oscillators,
  };
}

describe('Ringtone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start plays one oscillator per frequency and resumes context', () => {
    const ctx = fakeContext();
    const r = new Ringtone({
      createContext: () => ctx as unknown as AudioContext,
    });
    r.start('incoming');
    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx._oscillators.length).toBe(2);
  });

  it('loops: advancing one full cycle schedules another burst', () => {
    const ctx = fakeContext();
    const r = new Ringtone({
      createContext: () => ctx as unknown as AudioContext,
    });
    r.start('ringback');
    expect(ctx._oscillators.length).toBe(2);
    vi.advanceTimersByTime(1200 + 3000);
    expect(ctx._oscillators.length).toBe(4);
  });

  it('stop halts the loop', () => {
    const ctx = fakeContext();
    const r = new Ringtone({
      createContext: () => ctx as unknown as AudioContext,
    });
    r.start('incoming');
    r.stop();
    vi.advanceTimersByTime(10_000);
    expect(ctx._oscillators.length).toBe(2);
  });

  it('starting the same kind twice is idempotent', () => {
    const ctx = fakeContext();
    const r = new Ringtone({
      createContext: () => ctx as unknown as AudioContext,
    });
    r.start('incoming');
    r.start('incoming');
    expect(ctx._oscillators.length).toBe(2);
  });

  it('does nothing when no AudioContext is available', () => {
    const r = new Ringtone({ createContext: () => undefined });
    expect(() => r.start('incoming')).not.toThrow();
  });
});
