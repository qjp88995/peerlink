import { describe, expect, it } from 'vitest';

import {
  chooseWriterKind,
  detectCapabilities,
  manifestHasDirectory,
} from './writer';

describe('detectCapabilities', () => {
  it('reports fileSystemAccess based on showDirectoryPicker', () => {
    expect(
      detectCapabilities({ showDirectoryPicker: () => {} } as never)
    ).toEqual({ fileSystemAccess: true });
    expect(detectCapabilities({} as never)).toEqual({
      fileSystemAccess: false,
    });
  });
});

describe('chooseWriterKind', () => {
  const caps = (fs: boolean) => ({ fileSystemAccess: fs });
  it('uses fs-access for folders/multi when supported', () => {
    expect(
      chooseWriterKind(caps(true), { fileCount: 3, hasDirectory: true })
    ).toBe('fs-access');
  });
  it('falls back to zip for folders/multi without fs-access', () => {
    expect(
      chooseWriterKind(caps(false), { fileCount: 2, hasDirectory: false })
    ).toBe('zip');
  });
  it('uses blob for a single flat file', () => {
    expect(
      chooseWriterKind(caps(false), { fileCount: 1, hasDirectory: false })
    ).toBe('blob');
  });
});

describe('manifestHasDirectory', () => {
  it('detects nested relative paths', () => {
    expect(
      manifestHasDirectory([
        { fileId: 0, name: 'a', size: 0, relativePath: 'x/a' },
      ])
    ).toBe(true);
    expect(
      manifestHasDirectory([
        { fileId: 0, name: 'a', size: 0, relativePath: 'a' },
      ])
    ).toBe(false);
  });
});
