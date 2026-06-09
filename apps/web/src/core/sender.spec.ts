import { describe, expect, it } from 'vitest';

import { decodeFrame } from '@peerlink/protocol';

import type { SendChannel } from './channel';
import { buildManifest, type SourceFile, TransferSender } from './sender';

function memSource(fileId: number, path: string, bytes: number[]): SourceFile {
  const data = new Uint8Array(bytes);
  return {
    fileId,
    name: path.split('/').pop()!,
    size: data.length,
    relativePath: path,
    slice: async (start, end) => data.subarray(start, end),
  };
}

class RecordingChannel implements SendChannel {
  frames: Uint8Array[] = [];
  bufferedAmount = 0;
  send(data: Uint8Array) {
    this.frames.push(data.slice());
  }
  waitForDrain() {
    return Promise.resolve();
  }
}

describe('buildManifest', () => {
  it('sums total size and lists entries', () => {
    const m = buildManifest([
      memSource(0, 'a.txt', [1, 2, 3]),
      memSource(1, 'dir/b.txt', [4, 5]),
    ]);
    expect(m.type).toBe('manifest');
    expect(m.totalSize).toBe(5);
    expect(m.files[1]).toEqual({
      fileId: 1,
      name: 'b.txt',
      size: 2,
      relativePath: 'dir/b.txt',
    });
  });
});

describe('TransferSender', () => {
  it('emits data chunks then file-complete then transfer-complete', async () => {
    const ch = new RecordingChannel();
    const files = [memSource(0, 'a.bin', [10, 20, 30, 40, 50])];
    const sender = new TransferSender(ch, files, { chunkSize: 2 });
    await sender.streamAll();

    const decoded = ch.frames.map(decodeFrame);
    const dataFrames = decoded.filter(f => f.kind === 'data');
    // 5 字节、块大小 2 → 3 个数据块
    expect(dataFrames).toHaveLength(3);

    const controls = decoded.filter(f => f.kind === 'control');
    const types = controls.map(c =>
      c.kind === 'control' ? (c.message as { type: string }).type : ''
    );
    expect(types).toEqual(['file-complete', 'transfer-complete']);

    // 重组数据应等于源
    const payload = dataFrames.flatMap(f =>
      f.kind === 'data' ? Array.from(f.payload) : []
    );
    expect(payload).toEqual([10, 20, 30, 40, 50]);
  });

  it('reports progress monotonically up to total', async () => {
    const ch = new RecordingChannel();
    const files = [memSource(0, 'a.bin', [1, 2, 3, 4])];
    const seen: number[] = [];
    const sender = new TransferSender(ch, files, {
      chunkSize: 2,
      onProgress: sent => seen.push(sent),
    });
    await sender.streamAll();
    expect(seen[seen.length - 1]).toBe(4);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });

  it('waits for drain when buffered amount exceeds high watermark', async () => {
    let drainCalls = 0;
    const ch: SendChannel = {
      bufferedAmount: 10_000,
      send() {},
      waitForDrain: async () => {
        drainCalls++;
      },
    };
    const files = [memSource(0, 'a.bin', [1, 2, 3, 4, 5, 6])];
    const sender = new TransferSender(ch, files, {
      chunkSize: 2,
      highWater: 1000,
      lowWater: 500,
    });
    await sender.streamAll();
    expect(drainCalls).toBeGreaterThan(0);
  });
});
