import { afterEach, describe, expect, it } from 'vitest';

import { buildIceServers, iceServersFromEnv } from './ice-config';

describe('buildIceServers', () => {
  it('falls back to the default STUN list when none provided', () => {
    const servers = buildIceServers({});
    expect(servers).toHaveLength(1);
    expect(String(servers[0].urls)).toContain('stun:');
  });

  it('parses comma-separated STUN urls', () => {
    const servers = buildIceServers({ VITE_STUN_URLS: 'stun:a:1, stun:b:2' });
    expect(servers[0].urls).toEqual(['stun:a:1', 'stun:b:2']);
  });

  it('appends a TURN server with credentials when configured', () => {
    const servers = buildIceServers({
      VITE_STUN_URLS: 'stun:a:1',
      VITE_TURN_URL: 'turn:t:3478',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'p',
    });
    expect(servers).toHaveLength(2);
    expect(servers[1]).toEqual({
      urls: 'turn:t:3478',
      username: 'u',
      credential: 'p',
    });
  });

  it('omits TURN when url is empty', () => {
    const servers = buildIceServers({ VITE_TURN_URL: '' });
    expect(servers.every(s => String(s.urls).startsWith('stun'))).toBe(true);
  });
});

describe('iceServersFromEnv runtime override', () => {
  afterEach(() => {
    delete window.__PEERLINK_ICE__;
  });

  it('prefers runtime window config over build-time defaults', () => {
    window.__PEERLINK_ICE__ = {
      stunUrls: 'stun:runtime:9',
      turnUrl: 'turn:runtime:3478',
      turnUsername: 'ru',
      turnCredential: 'rp',
    };
    const servers = iceServersFromEnv();
    expect(servers[0].urls).toEqual(['stun:runtime:9']);
    expect(servers[1]).toMatchObject({ urls: 'turn:runtime:3478' });
  });

  it('treats empty runtime values as unset and falls back', () => {
    window.__PEERLINK_ICE__ = { stunUrls: '', turnUrl: '' };
    const servers = iceServersFromEnv();
    expect(String(servers[0].urls)).toContain('stun:');
    expect(servers.every(s => String(s.urls).startsWith('stun'))).toBe(true);
  });

  it('优先使用 window.peerlink.ice 而非 __PEERLINK_ICE__', () => {
    const original = window.peerlink;
    // @ts-expect-error 测试注入
    window.peerlink = { ice: { stunUrls: 'stun:bridge:3478' } };
    window.__PEERLINK_ICE__ = { stunUrls: 'stun:legacy:3478' };
    const servers = iceServersFromEnv();
    expect(servers.some(s => String(s.urls).includes('bridge'))).toBe(true);
    expect(servers.some(s => String(s.urls).includes('legacy'))).toBe(false);
    window.peerlink = original;
  });
});
