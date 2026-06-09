import {
  controlMessageSchema,
  Crc32,
  decodeFrame,
  type FileEntry,
} from '@peerlink/protocol';

import type { Writer } from './storage/writer';

export interface ReceiverManifest {
  type: 'manifest';
  files: FileEntry[];
  totalSize: number;
}

export interface TransferReceiverOptions {
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  onFileResult?: (fileId: number, ok: boolean) => void;
  onComplete?: () => void;
  onCancel?: (reason?: string) => void;
}

export class TransferReceiver {
  private crcs = new Map<number, Crc32>();
  private received = 0;

  constructor(
    private manifest: ReceiverManifest,
    private writer: Writer,
    private opts: TransferReceiverOptions
  ) {}

  async handleFrame(bytes: Uint8Array): Promise<void> {
    const frame = decodeFrame(bytes);
    if (frame.kind === 'data') {
      await this.writer.writeChunk(frame.fileId, frame.payload);
      this.crc(frame.fileId).update(frame.payload);
      this.received += frame.payload.length;
      this.opts.onProgress?.(this.received, this.manifest.totalSize);
      return;
    }
    const msg = controlMessageSchema.parse(frame.message);
    switch (msg.type) {
      case 'file-complete': {
        const ok = this.crc(msg.fileId).digest() === msg.crc32;
        await this.writer.closeFile(msg.fileId);
        this.opts.onFileResult?.(msg.fileId, ok);
        return;
      }
      case 'transfer-complete':
        await this.writer.finish();
        this.opts.onComplete?.();
        return;
      case 'cancel':
        await this.writer.abort();
        this.opts.onCancel?.(msg.reason);
        return;
    }
  }

  private crc(fileId: number): Crc32 {
    let c = this.crcs.get(fileId);
    if (!c) {
      c = new Crc32();
      this.crcs.set(fileId, c);
    }
    return c;
  }
}
