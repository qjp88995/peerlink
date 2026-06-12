import { describe, expect, it } from 'vitest';

import { formatDuration } from './voice-format';

describe('formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(5000)).toBe('0:05');
    expect(formatDuration(65000)).toBe('1:05');
    expect(formatDuration(600000)).toBe('10:00');
  });

  it('rounds to nearest second and floors at zero', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5400)).toBe('0:05');
  });
});
