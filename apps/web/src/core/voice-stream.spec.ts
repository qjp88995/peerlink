import { describe, expect, it } from 'vitest';

import { crc32 } from '@peerlink/protocol';

import type { SendChannel } from './channel';
import { VoiceStream } from './voice-stream';

function fakeChannel(): SendChannel {
  return {
    send() {},
    bufferedAmount: 0,
    waitForDrain: () => Promise.resolve(),
  };
}

/** 可手动触发的计时器，避免依赖真实时钟。 */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {
    set: (fn: () => void) => {
      const h = ++id;
      pending.set(h, fn);
      return h as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (h: ReturnType<typeof setTimeout>) => {
      pending.delete(h as unknown as number);
    },
    fire: () => {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    size: () => pending.size,
  };
}

const startV1 = {
  type: 'voice-start' as const,
  msgId: 'v1',
  streamId: 0,
  mimeType: 'audio/webm',
  durationMs: 1,
  totalSize: 2,
  ts: 1,
};

describe('VoiceStream — incomplete message TTL', () => {
  it('fails an incoming voice that never completes after the TTL', () => {
    const timers = fakeTimers();
    let failed: string | undefined;
    const vs = new VoiceStream({
      getChannel: fakeChannel,
      allocStreamId: () => 0,
      ttlMs: 1000,
      setTimeout: timers.set,
      clearTimeout: timers.clear,
      callbacks: { onVoiceFailed: id => (failed = id) },
    });

    vs.onVoiceStart(startV1);
    expect(failed).toBeUndefined();

    timers.fire(); // TTL 到期，voice-complete 始终未到
    expect(failed).toBe('v1');
  });

  it('clears the TTL timer once the voice completes in time', () => {
    const timers = fakeTimers();
    let failed: string | undefined;
    let ready: string | undefined;
    const vs = new VoiceStream({
      getChannel: fakeChannel,
      allocStreamId: () => 0,
      ttlMs: 1000,
      setTimeout: timers.set,
      clearTimeout: timers.clear,
      callbacks: {
        onVoiceReady: id => (ready = id),
        onVoiceFailed: id => (failed = id),
      },
    });

    const bytes = new Uint8Array([1, 2]);
    vs.onVoiceStart(startV1);
    vs.handleDataFrame(0, 0, bytes);
    vs.onVoiceComplete({
      type: 'voice-complete',
      msgId: 'v1',
      crc32: crc32(bytes),
    });

    expect(ready).toBe('v1');
    expect(timers.size()).toBe(0); // 计时器已随完成清除
    timers.fire(); // 即便此后误触发也不应再判失败
    expect(failed).toBeUndefined();
  });
});
