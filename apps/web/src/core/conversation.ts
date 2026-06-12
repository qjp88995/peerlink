import {
  BUFFER_HIGH_WATERMARK,
  BUFFER_LOW_WATERMARK,
  type CallRejectReason,
  controlMessageSchema,
  Crc32,
  crc32,
  decodeFrame,
  DEFAULT_CHUNK_SIZE,
  encodeControlFrame,
  encodeDataFrame,
  type FileEntry,
} from '@peerlink/protocol';

import { iceServersFromEnv } from '../lib/ice-config';
import { throttleProgress } from '../lib/progress-throttle';
import {
  type CallControl,
  type CallDir,
  type CallRecord,
  CallSession,
  type CallState,
} from './call-session';
import { rtcSendChannel, type SendChannel } from './channel';
import { acquireMic } from './mic';
import { PeerConnection } from './peer-connection';
import { TransferReceiver } from './receiver';
import {
  browserFileToSource,
  buildManifest,
  type SourceFile,
  TransferSender,
} from './sender';
import { SignalingClient } from './signaling-client';
import { BlobWriter } from './storage/blob-writer';
import { FsAccessWriter } from './storage/fs-access-writer';
import {
  decideWriter,
  detectCapabilities,
  manifestHasDirectory,
  type Writer,
} from './storage/writer';

/** disconnected 自愈宽限期：超时仍未恢复才关闭会话。 */
const GRACE_MS = 15_000;

export type Connection =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface TextItem {
  id: string;
  dir: 'out' | 'in';
  text: string;
  ts: number;
}

export interface VoiceItem {
  id: string;
  dir: 'out' | 'in';
  durationMs: number;
  size: number;
  ts: number;
}

export interface OutgoingFiles {
  transferId: string;
  entries: FileEntry[];
  totalSize: number;
}

export interface ConversationCallbacks {
  onRoom?: (roomId: string) => void;
  onConnection?: (state: Connection) => void;
  onText?: (item: TextItem) => void;
  onIncomingFiles?: (
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ) => void;
  onTransferStart?: (transferId: string) => void;
  onProgress?: (transferId: string, sent: number, total: number) => void;
  onTransferDone?: (transferId: string) => void;
  onTransferFailed?: (transferId: string, reason?: string) => void;
  onTransferRejected?: (transferId: string) => void;
  onVoiceStart?: (msgId: string, durationMs: number, totalSize: number) => void;
  onVoiceReady?: (msgId: string, bytes: Uint8Array, mimeType: string) => void;
  onVoiceFailed?: (msgId: string) => void;
  onCallStateChange?: (state: CallState, dir: CallDir | null) => void;
  onCallIncoming?: () => void;
  onCallError?: (reason: CallRejectReason) => void;
  onCallEnded?: (record: CallRecord) => void;
  onRemoteAudioTrack?: (track: MediaStreamTrack) => void;
}

interface OutgoingState {
  transferId: string;
  sources: SourceFile[];
}

interface IncomingState {
  transferId: string;
  files: FileEntry[];
  totalSize: number;
  receiver?: TransferReceiver;
}

interface VoiceAssembler {
  msgId: string;
  mimeType: string;
  durationMs: number;
  totalSize: number;
  chunks: Uint8Array[];
}

export interface ConversationDeps {
  channel: SendChannel;
  makeWriter: (files: FileEntry[]) => Promise<Writer>;
  callbacks: ConversationCallbacks;
  isInitiator: boolean;
  renegotiate: () => Promise<void>;
  addLocalAudio: (stream: MediaStream) => void;
  removeLocalAudio: () => void;
}

/** 对称会话核心：一条 DataChannel 上多路复用文字 + 多次文件传输。 */
export class Conversation {
  private channel: SendChannel;
  private makeWriter: ConversationDeps['makeWriter'];
  private cb: ConversationCallbacks;

  private nextFileId = 0;
  private outgoing = new Map<string, OutgoingState>();
  private incoming = new Map<string, IncomingState>();
  private fileIdToTransfer = new Map<number, string>();
  private active = new Set<string>(); // 进行中的 transferId（双向）
  private voiceIncoming = new Map<string, VoiceAssembler>(); // msgId -> assembler
  private voiceStreamToMsg = new Map<number, string>(); // streamId -> msgId
  private call: CallSession;

  constructor(deps: ConversationDeps) {
    this.channel = deps.channel;
    this.makeWriter = deps.makeWriter;
    this.cb = deps.callbacks;
    this.call = new CallSession({
      isInitiator: deps.isInitiator,
      sendControl: (m: CallControl) => this.channel.send(encodeControlFrame(m)),
      acquireMic,
      addLocalAudio: deps.addLocalAudio,
      removeLocalAudio: deps.removeLocalAudio,
      renegotiate: deps.renegotiate,
      genCallId: () => this.nextFileId++,
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
      callbacks: {
        onStateChange: (s, d) => this.cb.onCallStateChange?.(s, d),
        onIncoming: () => this.cb.onCallIncoming?.(),
        onError: r => this.cb.onCallError?.(r),
        onEnded: r => this.cb.onCallEnded?.(r),
      },
    });
  }

  dialCall(): Promise<void> {
    return this.call.dial();
  }
  acceptCall(): Promise<void> {
    return this.call.accept();
  }
  rejectCall(): void {
    this.call.reject();
  }
  hangupCall(): void {
    this.call.hangup();
  }
  /** 由 peer 的 'track' 事件驱动。 */
  handleRemoteTrack(track: MediaStreamTrack): void {
    this.call.onRemoteAudio();
    this.cb.onRemoteAudioTrack?.(track);
  }
  notifyConnectionState(state: RTCIceConnectionState): void {
    this.call.onConnectionState(state);
  }

  setChannel(channel: SendChannel): void {
    this.channel = channel;
  }

  sendText(text: string): TextItem {
    const item: TextItem = {
      id: crypto.randomUUID(),
      dir: 'out',
      text,
      ts: Date.now(),
    };
    this.channel.send(
      encodeControlFrame({
        type: 'chat',
        msgId: item.id,
        text,
        ts: item.ts,
      })
    );
    return item;
  }

  sendFiles(files: File[]): OutgoingFiles {
    const transferId = crypto.randomUUID();
    const sources = files.map(f => browserFileToSource(f, this.nextFileId++));
    const manifest = buildManifest(sources, transferId);
    this.outgoing.set(transferId, { transferId, sources });
    this.channel.send(encodeControlFrame(manifest));
    return {
      transferId,
      entries: manifest.files,
      totalSize: manifest.totalSize,
    };
  }

  sendVoice(
    bytes: Uint8Array,
    mimeType: string,
    durationMs: number
  ): { item: VoiceItem; done: Promise<void> } {
    const msgId = crypto.randomUUID();
    const streamId = this.nextFileId++;
    const item: VoiceItem = {
      id: msgId,
      dir: 'out',
      durationMs,
      size: bytes.length,
      ts: Date.now(),
    };
    const done = this.streamVoice(bytes, mimeType, durationMs, msgId, streamId);
    return { item, done };
  }

  private async streamVoice(
    bytes: Uint8Array,
    mimeType: string,
    durationMs: number,
    msgId: string,
    streamId: number
  ): Promise<void> {
    this.channel.send(
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
      if (this.channel.bufferedAmount > BUFFER_HIGH_WATERMARK) {
        await this.channel.waitForDrain(BUFFER_LOW_WATERMARK);
      }
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + DEFAULT_CHUNK_SIZE, bytes.length)
      );
      crcAccum.update(chunk);
      this.channel.send(encodeDataFrame(streamId, chunkIndex, chunk));
      chunkIndex++;
    }
    this.channel.send(
      encodeControlFrame({
        type: 'voice-complete',
        msgId,
        crc32: crcAccum.digest(),
      })
    );
  }

  async acceptTransfer(transferId: string): Promise<void> {
    const inc = this.incoming.get(transferId);
    if (!inc) return;
    const writer = await this.makeWriter(inc.files);
    const total = inc.totalSize;
    inc.receiver = new TransferReceiver(
      { type: 'manifest', files: inc.files, totalSize: total },
      writer,
      {
        onProgress: throttleProgress((received, t) =>
          this.cb.onProgress?.(transferId, received, t)
        ),
        onComplete: () => {
          this.active.delete(transferId);
          this.cb.onTransferDone?.(transferId);
        },
        onCancel: reason => {
          this.active.delete(transferId);
          this.cb.onTransferFailed?.(transferId, reason);
        },
      }
    );
    for (const f of inc.files) this.fileIdToTransfer.set(f.fileId, transferId);
    this.active.add(transferId);
    this.cb.onTransferStart?.(transferId);
    this.channel.send(encodeControlFrame({ type: 'accept', transferId }));
  }

  rejectTransfer(transferId: string): void {
    this.incoming.delete(transferId);
    this.channel.send(encodeControlFrame({ type: 'reject', transferId }));
  }

  async handleIncoming(bytes: Uint8Array): Promise<void> {
    const frame = decodeFrame(bytes);
    if (frame.kind === 'data') {
      const vmsg = this.voiceStreamToMsg.get(frame.fileId);
      if (vmsg) {
        const va = this.voiceIncoming.get(vmsg);
        if (va) va.chunks[frame.chunkIndex] = frame.payload.slice();
        return;
      }
      const tid = this.fileIdToTransfer.get(frame.fileId);
      const inc = tid ? this.incoming.get(tid) : undefined;
      if (!inc?.receiver) {
        console.warn(`drop data frame for unknown fileId ${frame.fileId}`);
        return;
      }
      await inc.receiver.handleFrame(bytes);
      return;
    }
    const msg = controlMessageSchema.parse(frame.message);
    switch (msg.type) {
      case 'chat':
        this.cb.onText?.({
          id: msg.msgId,
          dir: 'in',
          text: msg.text,
          ts: msg.ts,
        });
        return;
      case 'voice-start':
        this.voiceIncoming.set(msg.msgId, {
          msgId: msg.msgId,
          mimeType: msg.mimeType,
          durationMs: msg.durationMs,
          totalSize: msg.totalSize,
          chunks: [],
        });
        this.voiceStreamToMsg.set(msg.streamId, msg.msgId);
        this.cb.onVoiceStart?.(msg.msgId, msg.durationMs, msg.totalSize);
        return;
      case 'voice-complete': {
        const va = this.voiceIncoming.get(msg.msgId);
        if (!va) return;
        this.voiceIncoming.delete(va.msgId);
        for (const [sid, mid] of this.voiceStreamToMsg)
          if (mid === va.msgId) this.voiceStreamToMsg.delete(sid);
        const bytes = concatChunks(va.chunks, va.totalSize);
        if (crc32(bytes) !== msg.crc32) {
          this.cb.onVoiceFailed?.(va.msgId);
          return;
        }
        this.cb.onVoiceReady?.(va.msgId, bytes, va.mimeType);
        return;
      }
      case 'manifest':
        this.incoming.set(msg.transferId, {
          transferId: msg.transferId,
          files: msg.files,
          totalSize: msg.totalSize,
        });
        this.cb.onIncomingFiles?.(msg.transferId, msg.files, msg.totalSize);
        return;
      case 'accept': {
        const out = this.outgoing.get(msg.transferId);
        if (!out) return;
        this.active.add(msg.transferId);
        this.cb.onTransferStart?.(msg.transferId);
        const sender = new TransferSender(this.channel, out.sources, {
          transferId: msg.transferId,
          onProgress: throttleProgress((sent, total) =>
            this.cb.onProgress?.(msg.transferId, sent, total)
          ),
        });
        await sender.streamAll();
        this.active.delete(msg.transferId);
        this.cb.onTransferDone?.(msg.transferId);
        return;
      }
      case 'reject':
        this.outgoing.delete(msg.transferId);
        this.cb.onTransferRejected?.(msg.transferId);
        return;
      case 'call-invite':
      case 'call-accept':
      case 'call-reject':
      case 'call-end':
        this.call.onControl(msg);
        return;
      case 'file-complete':
      case 'transfer-complete':
      case 'cancel': {
        const tid =
          msg.type === 'file-complete'
            ? this.fileIdToTransfer.get(msg.fileId)
            : msg.transferId;
        const inc = tid ? this.incoming.get(tid) : undefined;
        if (!inc?.receiver) {
          console.warn(`drop control ${msg.type} for unknown transfer`);
          return;
        }
        await inc.receiver.handleFrame(bytes);
        return;
      }
    }
  }

  /** 对端断开：进行中传输全部标记失败。 */
  closeRemote(): void {
    this.cb.onConnection?.('closed');
    for (const tid of this.active)
      this.cb.onTransferFailed?.(tid, '对方已离开');
    this.active.clear();
    for (const va of this.voiceIncoming.values())
      this.cb.onVoiceFailed?.(va.msgId);
    this.voiceIncoming.clear();
    this.voiceStreamToMsg.clear();
    this.call.dispose();
  }
}

function signalUrl(): string {
  if (import.meta.env.VITE_SIGNAL_URL) return import.meta.env.VITE_SIGNAL_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const path = import.meta.env.VITE_SIGNAL_PATH ?? '/signal';
  return `${proto}://${location.host}${path}`;
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

function triggerDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function defaultMakeWriter(files: FileEntry[]): Promise<Writer> {
  const decision = decideWriter(detectCapabilities(), {
    fileCount: files.length,
    hasDirectory: manifestHasDirectory(files),
  });
  if (decision.kind === 'unsupported') throw new Error(decision.reason);
  if (decision.kind === 'fs-access') {
    const root = await window.showDirectoryPicker!();
    return new FsAccessWriter({ files }, root);
  }
  return new BlobWriter(
    { files },
    { onFile: (name, blob) => triggerDownload(name, blob) }
  );
}

export interface ConversationHandle {
  conversation: Conversation;
  sendText: (text: string) => TextItem;
  sendFiles: (files: File[]) => OutgoingFiles;
  sendVoice: (
    bytes: Uint8Array,
    mimeType: string,
    durationMs: number
  ) => { item: VoiceItem; done: Promise<void> };
  acceptTransfer: (transferId: string) => Promise<void>;
  rejectTransfer: (transferId: string) => void;
  dialCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangupCall: () => void;
  setMicEnabled: (enabled: boolean) => void;
  close: () => void;
}

/** 接线层：建立信令 + WebRTC，把 dc 消息喂给 Conversation。 */
export function startConversation(
  init: { mode: 'create' } | { mode: 'join'; roomId: string },
  callbacks: ConversationCallbacks
): ConversationHandle {
  const sig = new SignalingClient(signalUrl());
  let peer: PeerConnection | undefined;
  let targetPeerId: string | undefined;

  const isInitiator = init.mode === 'create';
  const conv = new Conversation({
    // 占位通道：通道未开时调用方应被 UI 禁用；真正通道在 onChannelOpen 注入
    channel: {
      send: () => {
        throw new Error('channel not open');
      },
      bufferedAmount: 0,
      waitForDrain: () => Promise.resolve(),
    },
    makeWriter: defaultMakeWriter,
    isInitiator,
    addLocalAudio: stream => peer?.addLocalAudio(stream),
    removeLocalAudio: () => peer?.removeLocalAudio(),
    renegotiate: () => peer?.renegotiate() ?? Promise.resolve(),
    callbacks,
  });

  const send = (payload: object) =>
    targetPeerId &&
    sig.signal(targetPeerId, payload as Record<string, unknown>);

  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  function clearGraceTimer() {
    if (graceTimer !== undefined) {
      clearTimeout(graceTimer);
      graceTimer = undefined;
    }
  }

  function buildPeer(onSignal: (p: object) => void) {
    return new PeerConnection({
      iceServers: iceServersFromEnv(),
      onSignal,
      onChannelOpen: dc => {
        conv.setChannel(rtcSendChannel(dc));
        callbacks.onConnection?.('connected');
      },
      onMessage: bytes => void conv.handleIncoming(bytes),
      onRemoteTrack: track => conv.handleRemoteTrack(track),
      onStateChange: state => {
        conv.notifyConnectionState(state);
        // connected/completed：仅当处于宽限期时视为自愈成功，恢复 UI。
        if (state === 'connected' || state === 'completed') {
          if (graceTimer !== undefined) {
            clearGraceTimer();
            callbacks.onConnection?.('connected');
          }
          return;
        }
        // disconnected：非终态，给宽限期等待自愈，不立即 teardown。
        if (state === 'disconnected') {
          if (torndown || graceTimer !== undefined) return;
          callbacks.onConnection?.('reconnecting');
          graceTimer = setTimeout(() => {
            graceTimer = undefined;
            conv.closeRemote();
            teardown();
          }, GRACE_MS);
          return;
        }
        // failed/closed：终态，立即关闭。
        if (state === 'failed' || state === 'closed') {
          clearGraceTimer();
          conv.closeRemote();
          teardown();
        }
      },
    });
  }

  // 释放底层资源（ws + RTCPeerConnection）。幂等：断开自动触发一次，
  // 用户手动移除会话再调一次也安全。
  let torndown = false;
  function teardown() {
    if (torndown) return;
    torndown = true;
    clearGraceTimer();
    peer?.close();
    sig.close();
  }

  sig.on('error', (_c, m) => {
    callbacks.onConnection?.('error');
    console.warn(m);
  });

  if (init.mode === 'create') {
    callbacks.onConnection?.('waiting');
    sig.on('open', () => sig.createRoom());
    sig.on('room-created', roomId => callbacks.onRoom?.(roomId));
    sig.on('peer-joined', async peerId => {
      targetPeerId = peerId;
      callbacks.onConnection?.('connecting');
      peer = buildPeer(send);
      await peer.startAsInitiator();
    });
    sig.on('signal', async (_from, payload) => {
      const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
      if (p.sdp) await peer?.acceptAnswer(p.sdp);
      else if (p.candidate) await peer?.addCandidate(p.candidate);
    });
  } else {
    sig.on('open', () => sig.joinRoom(init.roomId));
    sig.on('signal', async (from, payload) => {
      targetPeerId = from;
      const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
      if (!peer) {
        callbacks.onConnection?.('connecting');
        peer = buildPeer(
          out =>
            targetPeerId &&
            sig.signal(targetPeerId, out as Record<string, unknown>)
        );
      }
      if (p.sdp) await peer.acceptOffer(p.sdp);
      else if (p.candidate) await peer.addCandidate(p.candidate);
    });
  }

  return {
    conversation: conv,
    sendText: t => conv.sendText(t),
    sendFiles: f => conv.sendFiles(f),
    sendVoice: (bytes, mimeType, durationMs) =>
      conv.sendVoice(bytes, mimeType, durationMs),
    acceptTransfer: t => conv.acceptTransfer(t),
    rejectTransfer: t => conv.rejectTransfer(t),
    dialCall: () => conv.dialCall(),
    acceptCall: () => conv.acceptCall(),
    rejectCall: () => conv.rejectCall(),
    hangupCall: () => conv.hangupCall(),
    setMicEnabled: e => peer?.setMicEnabled(e),
    close: teardown,
  };
}
