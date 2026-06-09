import type { FileEntry } from '@peerlink/protocol';

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

export interface Writer {
  writeChunk(fileId: number, chunk: Uint8Array): Promise<void> | void;
  closeFile(fileId: number): Promise<void> | void;
  finish(): Promise<void> | void;
  abort(): Promise<void> | void;
}

export interface WriterCapabilities {
  fileSystemAccess: boolean;
}

export type WriterDecision =
  | { kind: 'fs-access' }
  | { kind: 'blob' }
  | { kind: 'unsupported'; reason: string };

const UNSUPPORTED_REASON =
  '当前浏览器不支持接收文件夹或多文件，请改用基于 Chromium 的浏览器（Chrome / Edge）。';

/** 探测浏览器写入能力。 */
export function detectCapabilities(
  win: Pick<Window, 'showDirectoryPicker'> | typeof globalThis = globalThis
): WriterCapabilities {
  return {
    fileSystemAccess:
      typeof (win as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      'function',
  };
}

/** 仅依据接收端能力与文件构成决定落盘方式。 */
export function decideWriter(
  caps: WriterCapabilities,
  opts: { fileCount: number; hasDirectory: boolean }
): WriterDecision {
  if (caps.fileSystemAccess) return { kind: 'fs-access' };
  const multi = opts.hasDirectory || opts.fileCount > 1;
  if (multi) return { kind: 'unsupported', reason: UNSUPPORTED_REASON };
  return { kind: 'blob' };
}

export function manifestHasDirectory(files: FileEntry[]): boolean {
  return files.some(f => f.relativePath.includes('/'));
}
