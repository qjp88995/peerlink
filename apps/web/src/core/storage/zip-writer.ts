import { BlobWriter as ZipBlobWriter, ZipWriter } from '@zip.js/zip.js';

import type { FileEntry } from '@peerlink/protocol';

import type { Writer } from './writer';

interface ZipManifest {
  files: FileEntry[];
}

/** 把所有文件流式打包为单个 .zip 并交付下载。 */
export class FolderZipWriter implements Writer {
  // ZipWriter<Blob>：BlobWriter 作为底层 WritableWriter，显式标注 Type=Blob
  // 使 close() 返回 Promise<Blob>（构造器无法从 WritableWriter 推断 Type）。
  private zip = new ZipWriter<Blob>(new ZipBlobWriter('application/zip'));
  private entryStreams = new Map<
    number,
    {
      controller: ReadableStreamDefaultController<Uint8Array>;
      done: Promise<unknown>;
    }
  >();

  constructor(
    private manifest: ZipManifest,
    private onZip: (blob: Blob) => Promise<void> | void
  ) {
    for (const entry of this.manifest.files) this.openEntry(entry);
  }

  private openEntry(entry: FileEntry): void {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: c => {
        controller = c;
      },
    });
    const done = this.zip.add(entry.relativePath, stream);
    this.entryStreams.set(entry.fileId, { controller, done });
  }

  writeChunk(fileId: number, chunk: Uint8Array): void {
    this.entryStreams.get(fileId)?.controller.enqueue(chunk);
  }

  closeFile(fileId: number): void {
    this.entryStreams.get(fileId)?.controller.close();
  }

  async finish(): Promise<void> {
    await Promise.all([...this.entryStreams.values()].map(e => e.done));
    const blob = await this.zip.close();
    await this.onZip(blob);
  }

  async abort(): Promise<void> {
    await this.zip.close().catch(() => {});
  }
}
