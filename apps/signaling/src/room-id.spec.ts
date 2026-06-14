import { describe, expect, it } from 'vitest';

import { generateRoomId, WORDS } from './room-id';

describe('generateRoomId', () => {
  it('produces 4 digits + two Chinese words from the list', () => {
    const id = generateRoomId(() => 0.5);
    expect(id).toMatch(/^\d{4}-.+-.+$/);
    const [, word1, word2] = id.split('-');
    expect(WORDS).toContain(word1);
    expect(WORDS).toContain(word2);
  });

  it('pads digits to 4 places', () => {
    const id = generateRoomId(() => 0); // 数字与索引都取 0
    expect(id.split('-')[0]).toBe('0000');
  });

  it('is deterministic given a fixed rng', () => {
    const rng = () => 0.123456;
    expect(generateRoomId(rng)).toBe(generateRoomId(rng));
  });

  it('draws from a large word list for adequate entropy', () => {
    // 公网开放下，组合数 10000 × |WORDS|² 需达到亿级以抗枚举。
    expect(WORDS.length).toBeGreaterThanOrEqual(180);
    expect(new Set(WORDS).size).toBe(WORDS.length); // 无重复词
  });
});
