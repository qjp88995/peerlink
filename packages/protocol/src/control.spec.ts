import { describe, expect, it } from 'vitest';

import { controlMessageSchema } from './control';

describe('controlMessageSchema', () => {
  it('accepts a manifest with file entries', () => {
    const msg = {
      type: 'manifest',
      totalSize: 2048,
      files: [
        { fileId: 0, name: 'a.jpg', size: 1024, relativePath: 'photos/a.jpg' },
        { fileId: 1, name: 'b.txt', size: 1024, relativePath: 'b.txt' },
      ],
    };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts accept / reject', () => {
    expect(controlMessageSchema.parse({ type: 'accept' })).toEqual({
      type: 'accept',
    });
    expect(controlMessageSchema.parse({ type: 'reject' })).toEqual({
      type: 'reject',
    });
  });

  it('accepts file-complete with crc32', () => {
    const msg = { type: 'file-complete', fileId: 0, crc32: 0xcbf43926 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });

  it('accepts transfer-complete and cancel', () => {
    expect(controlMessageSchema.parse({ type: 'transfer-complete' })).toEqual({
      type: 'transfer-complete',
    });
    expect(
      controlMessageSchema.parse({ type: 'cancel', reason: 'user' })
    ).toEqual({ type: 'cancel', reason: 'user' });
  });

  it('rejects negative file size', () => {
    expect(() =>
      controlMessageSchema.parse({
        type: 'manifest',
        totalSize: -1,
        files: [],
      })
    ).toThrow();
  });
});
