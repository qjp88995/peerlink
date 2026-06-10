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
  // 帧可能被并发派发（wiring 的 void conv.handleIncoming）。用 promise 链把
  // 各操作严格串行化，保证 closeFile/finish 一定在所有 writeChunk 落定之后执行，
  // 否则在 write() 挂起时 close() 会导致 FS Access 交换文件无法提交。
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private manifest: ReceiverManifest,
    private writer: Writer,
    private opts: TransferReceiverOptions
  ) {}

  handleFrame(bytes: Uint8Array): Promise<void> {
    this.chain = this.chain.then(() => this.process(bytes));
    return this.chain;
  }

  private async process(bytes: Uint8Array): Promise<void> {
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
