import { describe, expect, it } from 'vitest';

import { formatDuration } from './voice-format';

describe('formatDuration', () => {
  it('formats sub-minute durations as N"', () => {
    expect(formatDuration(4000)).toBe('4"');
    expect(formatDuration(0)).toBe('0"');
    expect(formatDuration(59000)).toBe('59"');
  });

  it('formats >= 1 minute as M\'SS"', () => {
    expect(formatDuration(60000)).toBe('1\'00"');
    expect(formatDuration(65000)).toBe('1\'05"');
    expect(formatDuration(600000)).toBe('10\'00"');
  });

  it('rounds to the nearest second', () => {
    expect(formatDuration(5400)).toBe('5"');
    expect(formatDuration(5600)).toBe('6"');
  });
});
