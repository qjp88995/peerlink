import { describe, expect, it } from 'vitest';

import { domainFromSignalUrl, normalizeSignalDomain } from './signal-url';

describe('normalizeSignalDomain', () => {
  it('补全裸域名为 wss + /signal', () => {
    expect(normalizeSignalDomain('peerlink.qinjiapeng.com')).toBe(
      'wss://peerlink.qinjiapeng.com/signal'
    );
  });
  it('https → wss 并补 /signal', () => {
    expect(normalizeSignalDomain('https://example.com')).toBe(
      'wss://example.com/signal'
    );
  });
  it('http → ws', () => {
    expect(normalizeSignalDomain('http://localhost:3001')).toBe(
      'ws://localhost:3001/signal'
    );
  });
  it('已是 wss 且带 /signal 时保持幂等', () => {
    expect(normalizeSignalDomain('wss://example.com/signal')).toBe(
      'wss://example.com/signal'
    );
  });
  it('保留非默认路径', () => {
    expect(normalizeSignalDomain('example.com/custom')).toBe(
      'wss://example.com/custom'
    );
  });
  it('去除首尾空白', () => {
    expect(normalizeSignalDomain('  peerlink.qinjiapeng.com  ')).toBe(
      'wss://peerlink.qinjiapeng.com/signal'
    );
  });
  it('空串抛错', () => {
    expect(() => normalizeSignalDomain('')).toThrow();
  });
});

describe('domainFromSignalUrl', () => {
  it('反解出供展示的裸域名', () => {
    expect(domainFromSignalUrl('wss://peerlink.qinjiapeng.com/signal')).toBe(
      'peerlink.qinjiapeng.com'
    );
  });
  it('非默认路径时带上路径', () => {
    expect(domainFromSignalUrl('wss://example.com/custom')).toBe(
      'example.com/custom'
    );
  });
});
