import { describe, expect, it } from 'vitest';

import { buildIceServers } from './ice-config';

describe('buildIceServers', () => {
  it('falls back to a default STUN when none provided', () => {
    const servers = buildIceServers({});
    expect(servers).toHaveLength(1);
    expect(servers[0].urls).toContain('stun:stun.l.google.com:19302');
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
