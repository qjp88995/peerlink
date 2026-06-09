import type { FileEntry } from '@peerlink/protocol';

import type { Writer } from './writer';

interface FsManifest {
  files: FileEntry[];
}

/** 把文件按 relativePath 原样写入用户选择的目录（Chromium）。 */
export class FsAccessWriter implements Writer {
  private streams = new Map<number, FileSystemWritableFileStream>();
  private ready: Promise<void>;

  constructor(
    private manifest: FsManifest,
    private root: FileSystemDirectoryHandle
  ) {
    this.ready = this.openAll();
  }

  private async openAll(): Promise<void> {
    for (const entry of this.manifest.files) {
      const parts = entry.relativePath.split('/');
      const fileName = parts.pop()!;
      let dir = this.root;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const handle = await dir.getFileHandle(fileName, { create: true });
      this.streams.set(entry.fileId, await handle.createWritable());
    }
  }

  async writeChunk(fileId: number, chunk: Uint8Array): Promise<void> {
    await this.ready;
    // 类型边界修正（仅类型，无运行时影响）：网络层 Uint8Array 为
    // Uint8Array<ArrayBufferLike>，而 DOM write() 期望 BufferSource
    // （ArrayBufferView<ArrayBuffer>）；运行时均为 ArrayBuffer 支撑。
    await this.streams.get(fileId)?.write(chunk as BufferSource);
  }

  async closeFile(fileId: number): Promise<void> {
    const s = this.streams.get(fileId);
    if (s) {
      await s.close();
      this.streams.delete(fileId);
    }
  }

  async finish(): Promise<void> {
    for (const s of this.streams.values()) await s.close();
    this.streams.clear();
  }

  async abort(): Promise<void> {
    for (const s of this.streams.values()) await s.abort().catch(() => {});
    this.streams.clear();
  }
}
