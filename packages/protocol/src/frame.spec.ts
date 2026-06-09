import { describe, expect, it } from 'vitest';

import { decodeFrame, encodeControlFrame, encodeDataFrame } from './frame';

describe('control frame', () => {
  it('round-trips a JSON control message', () => {
    const msg = { type: 'accept' };
    const frame = encodeControlFrame(msg);
    const decoded = decodeFrame(frame);
    expect(decoded.kind).toBe('control');
    if (decoded.kind === 'control') {
      expect(decoded.message).toEqual(msg);
    }
  });
});

describe('data frame', () => {
  it('round-trips fileId, chunkIndex and payload', () => {
    const payload = new Uint8Array([1, 2, 3, 250, 255]);
    const frame = encodeDataFrame(7, 42, payload);
    const decoded = decodeFrame(frame);
    expect(decoded.kind).toBe('data');
    if (decoded.kind === 'data') {
      expect(decoded.fileId).toBe(7);
      expect(decoded.chunkIndex).toBe(42);
      expect(Array.from(decoded.payload)).toEqual([1, 2, 3, 250, 255]);
    }
  });

  it('handles large 32-bit chunk indices', () => {
    const frame = encodeDataFrame(0, 4_000_000_000, new Uint8Array([9]));
    const decoded = decodeFrame(frame);
    if (decoded.kind === 'data') {
      expect(decoded.chunkIndex).toBe(4_000_000_000);
    } else {
      throw new Error('expected data frame');
    }
  });
});

describe('decodeFrame', () => {
  it('throws on unknown frame tag', () => {
    expect(() => decodeFrame(new Uint8Array([0xff, 0, 0]))).toThrow();
  });
});
