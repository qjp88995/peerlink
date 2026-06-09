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

export type WriterKind = 'fs-access' | 'zip' | 'blob';

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

/** 根据能力与是否含目录，决定使用哪种写入器。 */
export function chooseWriterKind(
  caps: WriterCapabilities,
  opts: { fileCount: number; hasDirectory: boolean }
): WriterKind {
  if (caps.fileSystemAccess && (opts.hasDirectory || opts.fileCount > 1)) {
    return 'fs-access';
  }
  if (opts.hasDirectory || opts.fileCount > 1) return 'zip';
  return 'blob';
}

export function manifestHasDirectory(files: FileEntry[]): boolean {
  return files.some(f => f.relativePath.includes('/'));
}
