import { afterEach, describe, expect, it, vi } from 'vitest';

import { throttleProgress } from './progress-throttle';

describe('throttleProgress', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns undefined when no callback given', () => {
    expect(throttleProgress(undefined)).toBeUndefined();
  });

  it('emits the first call, then drops calls within the interval', () => {
    let t = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    const fn = vi.fn();
    const throttled = throttleProgress(fn, 100)!;

    throttled(10, 1000); // first → emits
    t = 1050;
    throttled(20, 1000); // within interval → dropped
    t = 1100;
    throttled(30, 1000); // interval elapsed → emits

    expect(fn.mock.calls).toEqual([
      [10, 1000],
      [30, 1000],
    ]);
  });

  it('always emits the final value even within the interval', () => {
    let t = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    const fn = vi.fn();
    const throttled = throttleProgress(fn, 100)!;

    throttled(10, 1000); // first → emits
    t = 1010;
    throttled(1000, 1000); // received >= total → emits despite interval

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(1000, 1000);
  });
});
