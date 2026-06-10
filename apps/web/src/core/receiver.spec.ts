import { describe, expect, it, vi } from 'vitest';

import { crc32, encodeControlFrame, encodeDataFrame } from '@peerlink/protocol';

import { TransferReceiver } from './receiver';
import type { Writer } from './storage/writer';

function mockWriter() {
  const data = new Map<number, number[]>();
  const writer: Writer = {
    writeChunk(fileId, chunk) {
      const arr = data.get(fileId) ?? [];
      arr.push(...chunk);
      data.set(fileId, arr);
    },
    closeFile: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(),
  };
  return { writer, data };
}

const manifest = {
  type: 'manifest' as const,
  totalSize: 5,
  files: [{ fileId: 0, name: 'a.bin', size: 5, relativePath: 'a.bin' }],
};

describe('TransferReceiver', () => {
  it('reassembles chunks and verifies a matching CRC', async () => {
    const { writer, data } = mockWriter();
    const results: { fileId: number; ok: boolean }[] = [];
    const finished = vi.fn();
    const r = new TransferReceiver(manifest, writer, {
      onFileResult: (fileId, ok) => results.push({ fileId, ok }),
      onComplete: finished,
    });

    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    await r.handleFrame(encodeDataFrame(0, 0, bytes.subarray(0, 3)));
    await r.handleFrame(encodeDataFrame(0, 1, bytes.subarray(3, 5)));
    await r.handleFrame(
      encodeControlFrame({
        type: 'file-complete',
        fileId: 0,
        crc32: crc32(bytes),
      })
    );
    await r.handleFrame(
      encodeControlFrame({ type: 'transfer-complete', transferId: 't1' })
    );

    expect(data.get(0)).toEqual([10, 20, 30, 40, 50]);
    expect(results).toEqual([{ fileId: 0, ok: true }]);
    expect(writer.finish).toHaveBeenCalled();
    expect(finished).toHaveBeenCalled();
  });

  it('flags a CRC mismatch as failed', async () => {
    const { writer } = mockWriter();
    const results: boolean[] = [];
    const r = new TransferReceiver(manifest, writer, {
      onFileResult: (_id, ok) => results.push(ok),
    });
    await r.handleFrame(encodeDataFrame(0, 0, new Uint8Array([1, 2, 3, 4, 5])));
    await r.handleFrame(
      encodeControlFrame({ type: 'file-complete', fileId: 0, crc32: 12345 })
    );
    expect(results).toEqual([false]);
  });

  it('serializes operations: closeFile waits for an in-flight writeChunk', async () => {
    // 模拟 wiring 的并发派发（void conv.handleIncoming），不 await 第一帧。
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(res => {
      release = res;
    });
    const writer: Writer = {
      async writeChunk() {
        events.push('write:start');
        await gate;
        events.push('write:end');
      },
      closeFile() {
        events.push('close');
      },
      finish: vi.fn(),
      abort: vi.fn(),
    };
    const r = new TransferReceiver(manifest, writer, {});
    const p1 = r.handleFrame(
      encodeDataFrame(0, 0, new Uint8Array([1, 2, 3, 4, 5]))
    );
    const p2 = r.handleFrame(
      encodeControlFrame({ type: 'file-complete', fileId: 0, crc32: 0 })
    );
    release();
    await Promise.all([p1, p2]);
    expect(events).toEqual(['write:start', 'write:end', 'close']);
  });

  it('aborts the writer on cancel', async () => {
    const { writer } = mockWriter();
    const r = new TransferReceiver(manifest, writer, {});
    await r.handleFrame(
      encodeControlFrame({ type: 'cancel', transferId: 't1', reason: 'x' })
    );
    expect(writer.abort).toHaveBeenCalled();
  });
});
