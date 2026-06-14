import { describe, expect, it } from 'vitest';

import { rtcSendChannel } from './channel';

/** 最小 RTCDataChannel 替身：可控 bufferedAmount + 手动派发事件 + 监听器计数。 */
class FakeDataChannel {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  private listeners: Record<string, Set<() => void>> = {};

  addEventListener(type: string, h: () => void): void {
    (this.listeners[type] ??= new Set()).add(h);
  }
  removeEventListener(type: string, h: () => void): void {
    this.listeners[type]?.delete(h);
  }
  emit(type: string): void {
    for (const h of [...(this.listeners[type] ?? [])]) h();
  }
  listenerCount(type: string): number {
    return this.listeners[type]?.size ?? 0;
  }
  send(): void {}
}

function makeChannel(bufferedAmount: number) {
  const dc = new FakeDataChannel();
  dc.bufferedAmount = bufferedAmount;
  return { dc, ch: rtcSendChannel(dc as unknown as RTCDataChannel) };
}

describe('rtcSendChannel.waitForDrain', () => {
  it('resolves immediately when already at or below threshold', async () => {
    const { ch } = makeChannel(5);
    await expect(ch.waitForDrain(10)).resolves.toBeUndefined();
  });

  it('resolves on bufferedamountlow and detaches every listener', async () => {
    const { dc, ch } = makeChannel(100);
    const p = ch.waitForDrain(10);
    dc.emit('bufferedamountlow');
    await expect(p).resolves.toBeUndefined();
    expect(dc.listenerCount('bufferedamountlow')).toBe(0);
    expect(dc.listenerCount('close')).toBe(0);
    expect(dc.listenerCount('error')).toBe(0);
  });

  it('rejects (not hangs) when the channel closes mid-wait, detaching listeners', async () => {
    const { dc, ch } = makeChannel(100);
    const p = ch.waitForDrain(10);
    dc.emit('close');
    await expect(p).rejects.toThrow();
    expect(dc.listenerCount('bufferedamountlow')).toBe(0);
    expect(dc.listenerCount('close')).toBe(0);
  });
});
