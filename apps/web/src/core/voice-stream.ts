import {
  BUFFER_HIGH_WATERMARK,
  BUFFER_LOW_WATERMARK,
  type ControlMessage,
  Crc32,
  crc32,
  DEFAULT_CHUNK_SIZE,
  encodeControlFrame,
  encodeDataFrame,
} from '@peerlink/protocol';

import type { SendChannel } from './channel';

type VoiceStart = Extract<ControlMessage, { type: 'voice-start' }>;
type VoiceComplete = Extract<ControlMessage, { type: 'voice-complete' }>;

/** 接收侧未收齐的语音消息默认存活时间；超时即放弃，避免内存驻留。 */
const DEFAULT_VOICE_TTL_MS = 60_000;

interface VoiceAssembler {
  msgId: string;
  mimeType: string;
  durationMs: number;
  totalSize: number;
  chunks: Uint8Array[];
  timer?: ReturnType<typeof setTimeout>;
}

export interface VoiceStreamCallbacks {
  onVoiceStart?: (msgId: string, durationMs: number, totalSize: number) => void;
  onVoiceReady?: (msgId: string, bytes: Uint8Array, mimeType: string) => void;
  onVoiceFailed?: (msgId: string) => void;
}

export interface VoiceStreamDeps {
  /** 当前 DataChannel（可被 setChannel 替换，故用 getter）。 */
  getChannel: () => SendChannel;
  /** 从会话共享的帧 id 计数器分配 streamId。 */
  allocStreamId: () => number;
  callbacks: VoiceStreamCallbacks;
  ttlMs?: number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (h: ReturnType<typeof setTimeout>) => void;
}

/**
 * 语音消息的发送与接收组装，作为 Conversation 之上的独立子模块，
 * 对齐 CallSession / ScreenShare 的注入式状态机范式。一条 DataChannel
 * 上语音数据帧按 streamId 与文件传输复用，本模块只认领自己的 streamId。
 */
export class VoiceStream {
  private incoming = new Map<string, VoiceAssembler>(); // msgId -> assembler
  private streamToMsg = new Map<number, string>(); // streamId -> msgId
  private ttlMs: number;
  private setTimer: NonNullable<VoiceStreamDeps['setTimeout']>;
  private clearTimer: NonNullable<VoiceStreamDeps['clearTimeout']>;

  constructor(private deps: VoiceStreamDeps) {
    this.ttlMs = deps.ttlMs ?? DEFAULT_VOICE_TTL_MS;
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? (h => clearTimeout(h));
  }

  /** 发送一条语音消息，返回 msgId 与流式完成的 promise。 */
  send(
    bytes: Uint8Array,
    mimeType: string,
    durationMs: number
  ): { msgId: string; done: Promise<void> } {
    const msgId = crypto.randomUUID();
    const streamId = this.deps.allocStreamId();
    const done = this.stream(bytes, mimeType, durationMs, msgId, streamId);
    return { msgId, done };
  }

  private async stream(
    bytes: Uint8Array,
    mimeType: string,
    durationMs: number,
    msgId: string,
    streamId: number
  ): Promise<void> {
    const channel = this.deps.getChannel();
    channel.send(
      encodeControlFrame({
        type: 'voice-start',
        msgId,
        streamId,
        mimeType,
        durationMs,
        totalSize: bytes.length,
        ts: Date.now(),
      })
    );
    const crcAccum = new Crc32();
    let chunkIndex = 0;
    for (let offset = 0; offset < bytes.length; offset += DEFAULT_CHUNK_SIZE) {
      if (channel.bufferedAmount > BUFFER_HIGH_WATERMARK) {
        await channel.waitForDrain(BUFFER_LOW_WATERMARK);
      }
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + DEFAULT_CHUNK_SIZE, bytes.length)
      );
      crcAccum.update(chunk);
      channel.send(encodeDataFrame(streamId, chunkIndex, chunk));
      chunkIndex++;
    }
    channel.send(
      encodeControlFrame({
        type: 'voice-complete',
        msgId,
        crc32: crcAccum.digest(),
      })
    );
  }

  /** 认领属于语音流的数据帧；返回 true 表示已消费。 */
  handleDataFrame(
    streamId: number,
    chunkIndex: number,
    payload: Uint8Array
  ): boolean {
    const msgId = this.streamToMsg.get(streamId);
    if (!msgId) return false;
    const va = this.incoming.get(msgId);
    if (va) va.chunks[chunkIndex] = payload.slice();
    return true;
  }

  onVoiceStart(msg: VoiceStart): void {
    const va: VoiceAssembler = {
      msgId: msg.msgId,
      mimeType: msg.mimeType,
      durationMs: msg.durationMs,
      totalSize: msg.totalSize,
      chunks: [],
    };
    // TTL：对端永不发 voice-complete（崩溃/恶意）时放弃并清理。
    va.timer = this.setTimer(() => {
      if (!this.incoming.has(va.msgId)) return;
      this.discard(va);
      this.deps.callbacks.onVoiceFailed?.(va.msgId);
    }, this.ttlMs);
    this.incoming.set(msg.msgId, va);
    this.streamToMsg.set(msg.streamId, msg.msgId);
    this.deps.callbacks.onVoiceStart?.(
      msg.msgId,
      msg.durationMs,
      msg.totalSize
    );
  }

  onVoiceComplete(msg: VoiceComplete): void {
    const va = this.incoming.get(msg.msgId);
    if (!va) return;
    this.discard(va);
    const bytes = concatChunks(va.chunks, va.totalSize);
    if (crc32(bytes) !== msg.crc32) {
      this.deps.callbacks.onVoiceFailed?.(va.msgId);
      return;
    }
    this.deps.callbacks.onVoiceReady?.(va.msgId, bytes, va.mimeType);
  }

  /** 对端断开：在途语音全部失败并清理。 */
  closeRemote(): void {
    for (const va of this.incoming.values()) {
      if (va.timer !== undefined) this.clearTimer(va.timer);
      this.deps.callbacks.onVoiceFailed?.(va.msgId);
    }
    this.incoming.clear();
    this.streamToMsg.clear();
  }

  /** 移除 assembler 的所有状态（计时器 + 索引），不触发回调。 */
  private discard(va: VoiceAssembler): void {
    if (va.timer !== undefined) this.clearTimer(va.timer);
    this.incoming.delete(va.msgId);
    for (const [sid, mid] of this.streamToMsg)
      if (mid === va.msgId) this.streamToMsg.delete(sid);
  }
}

function concatChunks(chunks: Uint8Array[], totalSize: number): Uint8Array {
  const out = new Uint8Array(totalSize);
  let offset = 0;
  for (const c of chunks) {
    if (!c) continue;
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
