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

  // 锁定「上线坑」：空 / 全空白的 ALLOWED_ORIGINS 折叠为 null = 放行任意来源。
  // 公网要收紧必须显式填非空清单，否则 Origin 防护是空的。
  it('collapses an absent or blank ALLOWED_ORIGINS to null (allow any origin)', () => {
    expect(loadConfig({}).allowedOrigins).toBeNull();
    expect(loadConfig({ ALLOWED_ORIGINS: '' }).allowedOrigins).toBeNull();
    expect(loadConfig({ ALLOWED_ORIGINS: '  ,  ,' }).allowedOrigins).toBeNull();
  });

  it('parses and trims a comma-separated ALLOWED_ORIGINS allowlist', () => {
    expect(
      loadConfig({ ALLOWED_ORIGINS: 'https://a.example, https://b.example ' })
        .allowedOrigins
    ).toEqual(['https://a.example', 'https://b.example']);
  });
});
