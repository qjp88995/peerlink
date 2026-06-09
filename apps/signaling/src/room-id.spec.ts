import { describe, expect, it } from 'vitest';

import { generateRoomId, WORDS } from './room-id';

describe('generateRoomId', () => {
  it('produces 4 digits + dash + a Chinese word from the list', () => {
    const id = generateRoomId(() => 0.5);
    expect(id).toMatch(/^\d{4}-.+$/);
    const word = id.split('-')[1];
    expect(WORDS).toContain(word);
  });

  it('pads digits to 4 places', () => {
    const id = generateRoomId(() => 0); // 数字与索引都取 0
    expect(id.split('-')[0]).toBe('0000');
  });

  it('is deterministic given a fixed rng', () => {
    const rng = () => 0.123456;
    expect(generateRoomId(rng)).toBe(generateRoomId(rng));
  });
});
