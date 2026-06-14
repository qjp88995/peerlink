import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigStore, DEFAULT_SIGNAL_URL } from './config-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peerlink-cfg-'));
  file = join(dir, 'config.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ConfigStore', () => {
  it('文件不存在时给出默认信令地址', () => {
    const store = new ConfigStore(file);
    expect(store.get().signalUrl).toBe(DEFAULT_SIGNAL_URL);
  });

  it('setSignalDomain 规范化后持久化', () => {
    const store = new ConfigStore(file);
    store.setSignalDomain('example.com');
    expect(store.get().signalUrl).toBe('wss://example.com/signal');

    // 重新读盘，确认已落地
    expect(new ConfigStore(file).get().signalUrl).toBe(
      'wss://example.com/signal'
    );
  });

  it('setIce 持久化 ICE 配置', () => {
    const store = new ConfigStore(file);
    store.setIce({ stunUrls: 'stun:a:3478', turnUrl: 'turn:b:3478' });
    expect(new ConfigStore(file).get().ice).toEqual({
      stunUrls: 'stun:a:3478',
      turnUrl: 'turn:b:3478',
    });
  });

  it('损坏的 JSON 回退到默认值而非崩溃', () => {
    const store = new ConfigStore(file);
    store.setSignalDomain('example.com');
    // 写入垃圾
    writeGarbage(file);
    expect(new ConfigStore(file).get().signalUrl).toBe(DEFAULT_SIGNAL_URL);
  });
});

function writeGarbage(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').writeFileSync(path, '{ not json');
}
