import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults the create-room rate limit to a burst of 10 per 60s', () => {
    const c = loadConfig({});
    expect(c.rateLimit).toEqual({ capacity: 10, windowMs: 60_000 });
  });

  it('reads rate-limit overrides from env', () => {
    const c = loadConfig({
      ROOM_CREATE_BURST: '3',
      ROOM_CREATE_WINDOW_MS: '1000',
    });
    expect(c.rateLimit).toEqual({ capacity: 3, windowMs: 1000 });
  });
});
