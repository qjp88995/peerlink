import { describe, expect, it, vi } from 'vitest';

import {
  controlMessageSchema,
  crc32,
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

// call 功能不在本文件覆盖范围内，给一组空实现满足 ConversationDeps。
function callDeps() {
  return {
    isInitiator: false,
    renegotiate: () => Promise.resolve(),
    addLocalAudio: () => {},
    removeLocalAudio: () => {},
  };
}

function setup() {
  const ch = new RecordingChannel();
  const { writer, data } = mockWriter();
  const cb = makeCallbacks();
  const conv = new Conversation({
    ...callDeps(),
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
      ...callDeps(),
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

describe('Conversation — voice', () => {
  it('sendVoice emits voice-start, one data frame, then voice-complete', async () => {
    const ch = new RecordingChannel();
    const conv = new Conversation({
      ...callDeps(),
      channel: ch,
      makeWriter: async () => mockWriter().writer,
      callbacks: {},
    });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { item, done } = conv.sendVoice(bytes, 'audio/webm', 1234);
    await done;

    const msgs = controls(ch);
    expect(msgs[0]).toMatchObject({
      type: 'voice-start',
      msgId: item.id,
      mimeType: 'audio/webm',
      durationMs: 1234,
      totalSize: 5,
    });
    const dataFrames = ch.frames
      .map(decodeFrame)
      .filter(f => f.kind === 'data');
    expect(dataFrames.length).toBe(1);
    expect(msgs.at(-1)).toMatchObject({
      type: 'voice-complete',
      msgId: item.id,
    });
    expect(item).toMatchObject({ dir: 'out', durationMs: 1234, size: 5 });
  });

  it('sendVoice allocates streamId from the shared file counter', async () => {
    const ch = new RecordingChannel();
    const conv = new Conversation({
      ...callDeps(),
      channel: ch,
      makeWriter: async () => mockWriter().writer,
      callbacks: {},
    });
    conv.sendFiles([fileBlob('a.txt', [1, 2, 3])]); // 占用 fileId 0
    const { done } = conv.sendVoice(new Uint8Array([9]), 'audio/webm', 100);
    await done;
    const start = controls(ch).find(m => m?.type === 'voice-start');
    expect(start).toMatchObject({ streamId: 1 });
  });

  it('assembles an incoming voice message and verifies crc', async () => {
    const events: {
      start?: { msgId: string; durationMs: number; totalSize: number };
      ready?: { msgId: string; bytes: number[]; mimeType: string };
      failed?: string;
    } = {};
    const conv = new Conversation({
      ...callDeps(),
      channel: new RecordingChannel(),
      makeWriter: async () => mockWriter().writer,
      callbacks: {
        onVoiceStart: (msgId, durationMs, totalSize) =>
          (events.start = { msgId, durationMs, totalSize }),
        onVoiceReady: (msgId, bytes, mimeType) =>
          (events.ready = { msgId, bytes: Array.from(bytes), mimeType }),
        onVoiceFailed: msgId => (events.failed = msgId),
      },
    });
    const bytes = new Uint8Array([9, 8, 7, 6]);
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'voice-start',
        msgId: 'v1',
        streamId: 0,
        mimeType: 'audio/webm',
        durationMs: 500,
        totalSize: 4,
        ts: 1,
      })
    );
    await conv.handleIncoming(encodeDataFrame(0, 0, bytes));
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'voice-complete',
        msgId: 'v1',
        crc32: crc32(bytes),
      })
    );

    expect(events.start).toMatchObject({
      msgId: 'v1',
      durationMs: 500,
      totalSize: 4,
    });
    expect(events.ready).toMatchObject({
      msgId: 'v1',
      bytes: [9, 8, 7, 6],
      mimeType: 'audio/webm',
    });
    expect(events.failed).toBeUndefined();
  });

  it('fails an incoming voice message on crc mismatch', async () => {
    let failed: string | undefined;
    let ready = false;
    const conv = new Conversation({
      ...callDeps(),
      channel: new RecordingChannel(),
      makeWriter: async () => mockWriter().writer,
      callbacks: {
        onVoiceReady: () => (ready = true),
        onVoiceFailed: msgId => (failed = msgId),
      },
    });
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'voice-start',
        msgId: 'v2',
        streamId: 0,
        mimeType: 'audio/webm',
        durationMs: 1,
        totalSize: 2,
        ts: 1,
      })
    );
    await conv.handleIncoming(encodeDataFrame(0, 0, new Uint8Array([1, 2])));
    await conv.handleIncoming(
      encodeControlFrame({ type: 'voice-complete', msgId: 'v2', crc32: 999999 })
    );
    expect(failed).toBe('v2');
    expect(ready).toBe(false);
  });

  it('fails in-flight incoming voice when remote closes', async () => {
    let failed: string | undefined;
    const conv = new Conversation({
      ...callDeps(),
      channel: new RecordingChannel(),
      makeWriter: async () => mockWriter().writer,
      callbacks: { onVoiceFailed: msgId => (failed = msgId) },
    });
    await conv.handleIncoming(
      encodeControlFrame({
        type: 'voice-start',
        msgId: 'v3',
        streamId: 0,
        mimeType: 'audio/webm',
        durationMs: 1,
        totalSize: 4,
        ts: 1,
      })
    );
    conv.closeRemote();
    expect(failed).toBe('v3');
  });
});
