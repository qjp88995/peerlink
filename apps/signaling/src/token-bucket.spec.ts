import { describe, expect, it } from 'vitest';

import { TokenBucket } from './token-bucket';

describe('TokenBucket', () => {
  it('starts full and allows up to capacity consecutive consumes', () => {
    const b = new TokenBucket({ capacity: 3, refillPerMs: 0, now: () => 0 });
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false); // 桶已空
  });

  it('refills one token per refill interval as time passes', () => {
    const clock = { t: 0 };
    // refillPerMs = 1/1000 → 每 1000ms 补 1 个令牌
    const b = new TokenBucket({
      capacity: 2,
      refillPerMs: 1 / 1000,
      now: () => clock.t,
    });
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false); // 空
    clock.t = 999;
    expect(b.tryConsume()).toBe(false); // 不足 1 个令牌
    clock.t = 1000;
    expect(b.tryConsume()).toBe(true); // 补满 1 个
    expect(b.tryConsume()).toBe(false);
  });

  it('caps refilled tokens at capacity', () => {
    const clock = { t: 0 };
    const b = new TokenBucket({
      capacity: 2,
      refillPerMs: 1,
      now: () => clock.t,
    });
    b.tryConsume();
    b.tryConsume(); // 空
    clock.t = 10_000; // 远超补满所需，但封顶在 capacity=2
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
  });
});
