import { describe, expect, it } from 'vitest';

import { BlobWriter } from './blob-writer';

const manifest = {
  type: 'manifest' as const,
  totalSize: 3,
  files: [{ fileId: 0, name: 'a.bin', size: 3, relativePath: 'a.bin' }],
};

describe('BlobWriter', () => {
  it('delivers the assembled blob with correct bytes on finish', async () => {
    const delivered: { name: string; bytes: number[] }[] = [];
    const w = new BlobWriter(manifest, {
      onFile: async (name, blob) => {
        delivered.push({
          name,
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        });
      },
    });
    w.writeChunk(0, new Uint8Array([7, 8]));
    w.writeChunk(0, new Uint8Array([9]));
    w.closeFile(0);
    await w.finish();
    expect(delivered).toEqual([{ name: 'a.bin', bytes: [7, 8, 9] }]);
  });
});
