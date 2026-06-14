interface TokenBucketOptions {
  /** 桶容量，即可承受的突发次数上限。 */
  capacity: number;
  /** 每毫秒补充的令牌数（= capacity / 窗口毫秒数得到稳态速率）。 */
  refillPerMs: number;
  now?: () => number;
}

/**
 * 单连接级令牌桶限流器。初始满桶，按时间线性补充、封顶在 capacity。
 * 状态随持有它的 client 一起被 GC，不引入需额外清理的全局表。
 */
export class TokenBucket {
  private capacity: number;
  private refillPerMs: number;
  private now: () => number;
  private tokens: number;
  private updatedAt: number;

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerMs;
    this.now = opts.now ?? Date.now;
    this.tokens = opts.capacity;
    this.updatedAt = this.now();
  }

  /** 有令牌则消耗 1 个并返回 true；否则返回 false（被限流）。 */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.updatedAt;
    if (elapsed <= 0) return;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerMs
    );
    this.updatedAt = now;
  }
}
