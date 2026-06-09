import {
  BUFFER_HIGH_WATERMARK,
  BUFFER_LOW_WATERMARK,
  Crc32,
  DEFAULT_CHUNK_SIZE,
  encodeControlFrame,
  encodeDataFrame,
  type FileEntry,
} from '@peerlink/protocol';

import type { SendChannel } from './channel';

export interface SourceFile {
  fileId: number;
  name: string;
  size: number;
  relativePath: string;
  /** 返回 [start, end) 的字节。 */
  slice(start: number, end: number): Promise<Uint8Array>;
}

export interface ManifestMessage {
  type: 'manifest';
  files: FileEntry[];
  totalSize: number;
}

export function buildManifest(files: SourceFile[]): ManifestMessage {
  return {
    type: 'manifest',
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    files: files.map(f => ({
      fileId: f.fileId,
      name: f.name,
      size: f.size,
      relativePath: f.relativePath,
    })),
  };
}

/** 把浏览器 File 转为 SourceFile（保留 webkitRelativePath 的目录）。 */
export function browserFileToSource(file: File, fileId: number): SourceFile {
  const rel =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name;
  return {
    fileId,
    name: file.name,
    size: file.size,
    relativePath: rel,
    slice: async (start, end) =>
      new Uint8Array(await file.slice(start, end).arrayBuffer()),
  };
}

export interface TransferSenderOptions {
  chunkSize?: number;
  highWater?: number;
  lowWater?: number;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

export class TransferSender {
  private chunkSize: number;
  private highWater: number;
  private lowWater: number;
  private onProgress?: TransferSenderOptions['onProgress'];
  private totalBytes: number;

  constructor(
    private channel: SendChannel,
    private files: SourceFile[],
    opts: TransferSenderOptions = {}
  ) {
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.highWater = opts.highWater ?? BUFFER_HIGH_WATERMARK;
    this.lowWater = opts.lowWater ?? BUFFER_LOW_WATERMARK;
    this.onProgress = opts.onProgress;
    this.totalBytes = files.reduce((s, f) => s + f.size, 0);
  }

  async streamAll(): Promise<void> {
    let sent = 0;
    for (const file of this.files) {
      const crc = new Crc32();
      let chunkIndex = 0;
      for (let offset = 0; offset < file.size; offset += this.chunkSize) {
        if (this.channel.bufferedAmount > this.highWater) {
          await this.channel.waitForDrain(this.lowWater);
        }
        const end = Math.min(offset + this.chunkSize, file.size);
        const chunk = await file.slice(offset, end);
        crc.update(chunk);
        this.channel.send(encodeDataFrame(file.fileId, chunkIndex, chunk));
        chunkIndex++;
        sent += chunk.length;
        this.onProgress?.(sent, this.totalBytes);
      }
      this.channel.send(
        encodeControlFrame({
          type: 'file-complete',
          fileId: file.fileId,
          crc32: crc.digest(),
        })
      );
    }
    this.channel.send(encodeControlFrame({ type: 'transfer-complete' }));
  }
}
