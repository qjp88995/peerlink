import { describe, expect, it } from 'vitest';

import { controlMessageSchema } from './control';

describe('controlMessageSchema', () => {
  it('accepts a chat message', () => {
    const msg = { type: 'chat', msgId: 'm1', text: 'hello', ts: 1717999999 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('rejects chat text over 8192 chars', () => {
    expect(() =>
      controlMessageSchema.parse({
        type: 'chat',
        msgId: 'm1',
        text: 'x'.repeat(8193),
        ts: 1,
      })
    ).toThrow();
  });

  it('accepts a manifest carrying a transferId', () => {
    const msg = {
      type: 'manifest',
      transferId: 't1',
      totalSize: 2048,
      files: [
        { fileId: 0, name: 'a.jpg', size: 1024, relativePath: 'photos/a.jpg' },
        { fileId: 1, name: 'b.txt', size: 1024, relativePath: 'b.txt' },
      ],
    };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('requires transferId on manifest', () => {
    expect(() =>
      controlMessageSchema.parse({ type: 'manifest', totalSize: 0, files: [] })
    ).toThrow();
  });

  it('accepts accept / reject with transferId', () => {
    expect(
      controlMessageSchema.parse({ type: 'accept', transferId: 't1' })
    ).toEqual({ type: 'accept', transferId: 't1' });
    expect(
      controlMessageSchema.parse({ type: 'reject', transferId: 't1' })
    ).toEqual({ type: 'reject', transferId: 't1' });
  });

  it('accepts file-complete with crc32 (no transferId)', () => {
    const msg = { type: 'file-complete', fileId: 0, crc32: 0xcbf43926 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts transfer-complete and cancel with transferId', () => {
    expect(
      controlMessageSchema.parse({
        type: 'transfer-complete',
        transferId: 't1',
      })
    ).toEqual({ type: 'transfer-complete', transferId: 't1' });
    expect(
      controlMessageSchema.parse({
        type: 'cancel',
        transferId: 't1',
        reason: 'user',
      })
    ).toEqual({ type: 'cancel', transferId: 't1', reason: 'user' });
  });

  it('rejects negative file size', () => {
    expect(() =>
      controlMessageSchema.parse({
        type: 'manifest',
        transferId: 't1',
        totalSize: -1,
        files: [],
      })
    ).toThrow();
  });

  it('accepts a voice-start message', () => {
    const msg = {
      type: 'voice-start',
      msgId: 'v1',
      streamId: 3,
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 4200,
      totalSize: 8192,
      ts: 1717999999,
    };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts a voice-complete message', () => {
    const msg = { type: 'voice-complete', msgId: 'v1', crc32: 123456 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('rejects voice-start with negative streamId', () => {
    expect(() =>
      controlMessageSchema.parse({
        type: 'voice-start',
        msgId: 'v1',
        streamId: -1,
        mimeType: 'audio/webm',
        durationMs: 1,
        totalSize: 1,
        ts: 1,
      })
    ).toThrow();
  });
});
