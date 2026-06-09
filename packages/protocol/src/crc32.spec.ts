import { describe, expect, it } from 'vitest';

import { Crc32, crc32 } from './crc32';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the standard test vector for "123456789"', () => {
    // 标准 CRC-32 (IEEE 802.3) 校验值
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  it('returns 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('produces an unsigned 32-bit integer', () => {
    const v = crc32(bytes('hello world'));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('Crc32 (incremental)', () => {
  it('chained updates equal a single-shot call', () => {
    const full = crc32(bytes('123456789'));
    const c = new Crc32();
    c.update(bytes('1234'));
    c.update(bytes('56789'));
    expect(c.digest()).toBe(full);
  });
});
