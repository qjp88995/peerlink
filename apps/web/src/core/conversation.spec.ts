import { describe, expect, it, vi } from 'vitest';

import {
  controlMessageSchema,
  decodeFrame,
  encodeControlFrame,
  encodeDataFrame,
  type FileEntry,
} from '@peerlink/protocol';

import type { SendChannel } from './channel';
import { Conversation } from './conversation';
import type { Writer } from './storage/writer';

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

function controls(ch: RecordingChannel) {
  return ch.frames
    .map(decodeFrame)
    .filter(f => f.kind === 'control')
    .map(f =>
      f.kind === 'control' ? controlMessageSchema.parse(f.message) : null
    );
}

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

// jsdom 的 File.slice() 返回的 Blob 缺 arrayBuffer（setup 只换了全局 Blob），
// 这里构造一个最小 File-like，slice().arrayBuffer() 可用，绕开 jsdom File。
function fileBlob(name: string, bytes: number[]): File {
  const data = new Uint8Array(bytes);
  return {
    name,
    size: data.length,
    webkitRelativePath: '',
    slice: (start?: number, end?: number) => ({
      arrayBuffer: async () =>
        data.slice(start ?? 0, end ?? data.length).buffer,
    }),
  } as unknown as File;
}

function makeCallbacks() {
  return {
    onRoom: vi.fn(),
    onConnection: vi.fn(),
    onText: vi.fn(),
    onIncomingFiles: vi.fn(),
    onTransferStart: vi.fn(),
    onProgress: vi.fn(),
    onTransferDone: vi.fn(),
    onTransferFailed: vi.fn(),
    onTransferRejected: vi.fn(),
  };
}

function setup() {
  const ch = new RecordingChannel();
  const { writer, data } = mockWriter();
  const cb = makeCallbacks();
  const conv = new Conversation({
    channel: ch,
    makeWriter: async () => writer,
    callbacks: cb,
  });
  return { ch, conv, cb, writer, data };
}

describe('Conversation — text', () => {
  it('sendText emits a chat control frame and returns the item', () => {
    const { ch, conv } = setup();
    const item = conv.sendText('hello');
    expect(item.text).toBe('hello');
    const [msg] = controls(ch);
    expect(msg).toMatchObject({ type: 'chat', text: 'hello', msgId: item.id });
  });

  it('incoming chat frame fires onText with dir in', async () => {
    const { conv, cb } = setup();
    await conv.handleIncoming(
      encodeControlFrame({ type: 'chat', msgId: 'm', text: 'yo', ts: 1 })
    );
    expect(cb.onText).toHaveBeenCalledWith(
      expect.objectContaining({ dir: 'in', text: 'yo', id: 'm' })
    );
  });
});

describe('Conversation — incoming file handshake', () => {
  it('accepts a transfer, streams data into the writer, completes', async () => {
    const { ch, conv, cb, data } = setup();
    const files: FileEntry[] = [
      { fileId: 0, name: 'a.bin', size: 3, relativePath: 'a.bin' },
    ];
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'T1',
        files,
        totalSize: 3,
      })
    );
    expect(cb.onIncomingFiles).toHaveBeenCalledWith('T1', files, 3);

    await conv.acceptTransfer('T1');
    expect(controls(ch).at(-1)).toEqual({ type: 'accept', transferId: 'T1' });

    await conv.handleIncoming(encodeDataFrame(0, 0, new Uint8Array([7, 8, 9])));
    await conv.handleIncoming(
      encodeControlFrame({ type: 'transfer-complete', transferId: 'T1' })
    );
    expect(data.get(0)).toEqual([7, 8, 9]);
    expect(cb.onProgress).toHaveBeenCalledWith('T1', 3, 3);
    expect(cb.onTransferDone).toHaveBeenCalledWith('T1');
  });

  it('rejectTransfer sends a reject frame', async () => {
    const { ch, conv } = setup();
    const files: FileEntry[] = [
      { fileId: 0, name: 'a.bin', size: 1, relativePath: 'a.bin' },
    ];
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'T1',
        files,
        totalSize: 1,
      })
    );
    conv.rejectTransfer('T1');
    expect(controls(ch).at(-1)).toEqual({ type: 'reject', transferId: 'T1' });
  });
});

describe('Conversation — outgoing file handshake', () => {
  it('sendFiles emits a manifest with monotonic fileIds; accept triggers streaming', async () => {
    const { ch, conv, cb } = setup();
    const out = conv.sendFiles([fileBlob('a.bin', [1, 2, 3, 4])]);
    expect(out.entries[0].fileId).toBe(0);
    const manifest = controls(ch).find(m => m?.type === 'manifest');
    expect(manifest).toMatchObject({
      type: 'manifest',
      transferId: out.transferId,
    });

    await conv.handleIncoming(
      encodeControlFrame({ type: 'accept', transferId: out.transferId })
    );
    expect(cb.onTransferStart).toHaveBeenCalledWith(out.transferId);
    const types = ch.frames.map(decodeFrame).map(f => f.kind);
    expect(types).toContain('data');
    expect(cb.onTransferDone).toHaveBeenCalledWith(out.transferId);
  });

  it('peer reject marks the outgoing transfer rejected', async () => {
    const { conv, cb } = setup();
    const out = conv.sendFiles([fileBlob('a.bin', [1])]);
    await conv.handleIncoming(
      encodeControlFrame({ type: 'reject', transferId: out.transferId })
    );
    expect(cb.onTransferRejected).toHaveBeenCalledWith(out.transferId);
  });
});

describe('Conversation — multiplexing', () => {
  it('routes interleaved data frames to the right writer by fileId', async () => {
    const ch = new RecordingChannel();
    const w1 = mockWriter();
    const w2 = mockWriter();
    const writers = [w1.writer, w2.writer];
    let n = 0;
    const cb = makeCallbacks();
    const conv = new Conversation({
      channel: ch,
      makeWriter: async () => writers[n++],
      callbacks: cb,
    });
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'A',
        files: [{ fileId: 0, name: 'a', size: 1, relativePath: 'a' }],
        totalSize: 1,
      })
    );
    await conv.acceptTransfer('A');
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'B',
        files: [{ fileId: 1, name: 'b', size: 1, relativePath: 'b' }],
        totalSize: 1,
      })
    );
    await conv.acceptTransfer('B');

    await conv.handleIncoming(encodeDataFrame(1, 0, new Uint8Array([99])));
    await conv.handleIncoming(encodeDataFrame(0, 0, new Uint8Array([11])));

    expect(w1.data.get(0)).toEqual([11]);
    expect(w2.data.get(1)).toEqual([99]);
  });
});

describe('Conversation — connection', () => {
  it('closeRemote marks in-flight transfers failed', async () => {
    const { conv, cb } = setup();
    const files: FileEntry[] = [
      { fileId: 0, name: 'a', size: 9, relativePath: 'a' },
    ];
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'manifest',
        transferId: 'T1',
        files,
        totalSize: 9,
      })
    );
    await conv.acceptTransfer('T1');
    conv.closeRemote();
    expect(cb.onConnection).toHaveBeenCalledWith('closed');
    expect(cb.onTransferFailed).toHaveBeenCalledWith('T1', expect.anything());
  });
});
