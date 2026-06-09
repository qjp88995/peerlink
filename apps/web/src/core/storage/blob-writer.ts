import type { FileEntry } from '@peerlink/protocol';

import type { Writer } from './writer';

interface BlobManifest {
  files: FileEntry[];
}

export interface BlobWriterOptions {
  /** 文件就绪时交付（生产环境：触发下载）。 */
  onFile: (name: string, blob: Blob) => Promise<void> | void;
}

export class BlobWriter implements Writer {
  private parts = new Map<number, BlobPart[]>();

  constructor(
    private manifest: BlobManifest,
    private opts: BlobWriterOptions
  ) {}

  writeChunk(fileId: number, chunk: Uint8Array): void {
    const arr = this.parts.get(fileId) ?? [];
    // 复制一份，避免底层缓冲被复用
    arr.push(chunk.slice());
    this.parts.set(fileId, arr);
  }

  closeFile(_fileId: number): void {
    /* Blob 在 finish 时统一组装 */
  }

  async finish(): Promise<void> {
    for (const entry of this.manifest.files) {
      const blob = new Blob(this.parts.get(entry.fileId) ?? []);
      await this.opts.onFile(entry.name, blob);
    }
  }

  abort(): void {
    this.parts.clear();
  }
}
