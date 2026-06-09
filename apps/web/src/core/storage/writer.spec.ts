import { describe, expect, it } from 'vitest';

import {
  decideWriter,
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

describe('decideWriter', () => {
  const caps = (fs: boolean) => ({ fileSystemAccess: fs });

  it('uses fs-access for a single file when supported', () => {
    expect(
      decideWriter(caps(true), { fileCount: 1, hasDirectory: false })
    ).toEqual({ kind: 'fs-access' });
  });

  it('uses fs-access for folders/multi when supported', () => {
    expect(
      decideWriter(caps(true), { fileCount: 3, hasDirectory: true })
    ).toEqual({ kind: 'fs-access' });
  });

  it('uses blob for a single flat file without fs-access', () => {
    expect(
      decideWriter(caps(false), { fileCount: 1, hasDirectory: false })
    ).toEqual({ kind: 'blob' });
  });

  it('is unsupported for multi files without fs-access', () => {
    const d = decideWriter(caps(false), { fileCount: 2, hasDirectory: false });
    expect(d.kind).toBe('unsupported');
  });

  it('is unsupported for folders without fs-access', () => {
    const d = decideWriter(caps(false), { fileCount: 1, hasDirectory: true });
    expect(d.kind).toBe('unsupported');
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
