export interface Writer {
  writeChunk(fileId: number, chunk: Uint8Array): Promise<void> | void;
  closeFile(fileId: number): Promise<void> | void;
  finish(): Promise<void> | void;
  abort(): Promise<void> | void;
}
