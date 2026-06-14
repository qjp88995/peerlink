import {
  type CallRejectReason,
  controlMessageSchema,
  decodeFrame,
  encodeControlFrame,
  type FileEntry,
} from '@peerlink/protocol';

import { getSignalUrl } from '../lib/desktop-bridge';
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
  type ScreenControl,
  type ScreenError,
  ScreenShare,
  type ScreenState,
} from './screen-share';
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
import { VoiceStream } from './voice-stream';

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
  onScreenStateChange?: (state: ScreenState) => void;
  onLocalScreenStream?: (stream: MediaStream | null) => void;
  onRemoteScreenTrack?: (track: MediaStreamTrack) => void;
  onScreenError?: (reason: ScreenError) => void;
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

export interface ConversationDeps {
  channel: SendChannel;
  makeWriter: (files: FileEntry[]) => Promise<Writer>;
  callbacks: ConversationCallbacks;
  isInitiator: boolean;
  renegotiate: () => Promise<void>;
  addLocalAudio: (stream: MediaStream) => void;
  removeLocalAudio: () => void;
  setScreenTrack: (track: MediaStreamTrack) => void;
  prepareRecvVideo: () => void;
  clearScreenTrack: () => void;
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
  private voice: VoiceStream;
  private call: CallSession;
  private screen: ScreenShare;

  constructor(deps: ConversationDeps) {
    this.channel = deps.channel;
    this.makeWriter = deps.makeWriter;
    this.cb = deps.callbacks;
    this.voice = new VoiceStream({
      getChannel: () => this.channel,
      allocStreamId: () => this.nextFileId++,
      callbacks: {
        onVoiceStart: (id, dur, total) =>
          this.cb.onVoiceStart?.(id, dur, total),
        onVoiceReady: (id, bytes, mime) =>
          this.cb.onVoiceReady?.(id, bytes, mime),
        onVoiceFailed: id => this.cb.onVoiceFailed?.(id),
      },
    });
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
        onStateChange: (s, d) => {
          // 挂断/结束会议时一并收尾屏幕共享：停本地采集、清轨、复位。
          if (s === 'idle') this.screen.dispose();
          this.cb.onCallStateChange?.(s, d);
        },
        onIncoming: () => this.cb.onCallIncoming?.(),
        onError: r => this.cb.onCallError?.(r),
        onEnded: r => this.cb.onCallEnded?.(r),
      },
    });
    this.screen = new ScreenShare({
      isInitiator: deps.isInitiator,
      sendControl: (m: ScreenControl) =>
        this.channel.send(encodeControlFrame(m)),
      acquireDisplay: () =>
        navigator.mediaDevices.getDisplayMedia({ video: true }),
      setScreenTrack: deps.setScreenTrack,
      prepareRecvVideo: deps.prepareRecvVideo,
      clearScreenTrack: deps.clearScreenTrack,
      renegotiate: deps.renegotiate,
      getCallId: () => this.call.currentCallId(),
      callbacks: {
        onStateChange: s => this.cb.onScreenStateChange?.(s),
        onLocalStream: s => this.cb.onLocalScreenStream?.(s),
        onError: r => this.cb.onScreenError?.(r),
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
  startScreenShare(): Promise<void> {
    return this.screen.start();
  }
  stopScreenShare(): Promise<void> {
    return this.screen.stop();
  }
  /** 由 peer 的 'track' 事件驱动。 */
  handleRemoteTrack(track: MediaStreamTrack): void {
    if (track.kind === 'video') {
      this.cb.onRemoteScreenTrack?.(track);
      return;
    }
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
    const { msgId, done } = this.voice.send(bytes, mimeType, durationMs);
    const item: VoiceItem = {
      id: msgId,
      dir: 'out',
      durationMs,
      size: bytes.length,
      ts: Date.now(),
    };
    return { item, done };
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
      if (
        this.voice.handleDataFrame(
          frame.fileId,
          frame.chunkIndex,
          frame.payload
        )
      )
        return;
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
        this.voice.onVoiceStart(msg);
        return;
      case 'voice-complete':
        this.voice.onVoiceComplete(msg);
        return;
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
        try {
          await sender.streamAll();
          this.active.delete(msg.transferId);
          this.cb.onTransferDone?.(msg.transferId);
        } catch (err) {
          // 流式读取/发送中途失败（文件被删、磁盘错误、通道关闭）：
          // 清理活跃集合并告知 UI，避免传输永远卡在「进行中」。
          this.active.delete(msg.transferId);
          this.cb.onTransferFailed?.(
            msg.transferId,
            err instanceof Error ? err.message : '发送失败'
          );
        }
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
      case 'screen-start':
      case 'screen-stop':
        await this.screen.onControl(msg);
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
    this.voice.closeRemote();
    this.call.dispose();
    this.screen.dispose();
  }
}

function signalUrl(): string {
  const desktop = getSignalUrl();
  if (desktop) return desktop; // 桌面端：运行时最新值，改设置后即时生效
  if (import.meta.env.VITE_SIGNAL_URL) return import.meta.env.VITE_SIGNAL_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const path = import.meta.env.VITE_SIGNAL_PATH ?? '/signal';
  return `${proto}://${location.host}${path}`;
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
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
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
  // P2P 是否曾经接通：通道一旦打开，文字/文件/语音即走 P2P 自足，
  // 之后信令断开不影响已建立的传输；据此区分「建连阶段断信令」与「已接通后断信令」。
  let everConnected = false;

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
    setScreenTrack: t => peer?.setScreenTrack(t),
    prepareRecvVideo: () => peer?.prepareRecvVideo(),
    clearScreenTrack: () => peer?.clearScreenTrack(),
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
  // 进入自愈宽限：ICE 暂时断开或对端刷新离开后，等待其自愈/重新加入，
  // 超时仍未恢复才真正收尾。dedup：宽限进行中重复调用无副作用。
  function startGrace() {
    if (torndown || graceTimer !== undefined) return;
    callbacks.onConnection?.('reconnecting');
    graceTimer = setTimeout(() => {
      graceTimer = undefined;
      conv.closeRemote();
      teardown();
    }, GRACE_MS);
  }

  // 连接代际：对端刷新/重连会重建 peer。每条 peer 持有自己的 myGen，
  // 所有事件回调先校验仍是当前代——被新连接取代的孤儿 peer（旧的
  // RTCPeerConnection）的 disconnected/failed/closed 事件一律忽略，
  // 否则它会污染共享的 grace/teardown/通话状态，把好端端的新连接和
  // 信令一起拆掉。
  let gen = 0;

  function buildPeer(onSignal: (p: object) => void) {
    const myGen = ++gen;
    const current = () => myGen === gen && !torndown;
    return new PeerConnection({
      iceServers: iceServersFromEnv(),
      onSignal: payload => {
        if (current()) onSignal(payload);
      },
      onChannelOpen: dc => {
        if (!current()) return;
        everConnected = true;
        conv.setChannel(rtcSendChannel(dc));
        callbacks.onConnection?.('connected');
      },
      onMessage: bytes => {
        if (current()) void conv.handleIncoming(bytes);
      },
      onRemoteTrack: track => {
        if (current()) conv.handleRemoteTrack(track);
      },
      onStateChange: state => {
        if (!current()) return;
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
          startGrace();
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

  // 信令连接断开（服务器不可达 / 中途掉线）。建连阶段断开 = 无法接通，
  // 报错并收尾，避免 UI 永远停在 waiting/connecting；已接通后断开则忽略，
  // 数据走 P2P 自足，强行 teardown 反而会杀掉正在进行的传输。
  sig.on('close', () => {
    if (torndown || everConnected) return;
    callbacks.onConnection?.('error');
    teardown();
  });

  if (init.mode === 'create') {
    callbacks.onConnection?.('waiting');
    sig.on('open', () => sig.createRoom());
    sig.on('room-created', roomId => callbacks.onRoom?.(roomId));
    sig.on('peer-joined', async peerId => {
      // 对端加入（可能是刷新后重新加入的同一用户）：重建连接。
      // 先清宽限、关闭旧 peer——旧 peer 的事件已因代际失效被忽略，
      // 其 close() 触发的 closed 事件不会误拆新连接。
      targetPeerId = peerId;
      callbacks.onConnection?.('connecting');
      clearGraceTimer();
      const previous = peer;
      peer = buildPeer(send);
      previous?.close();
      await peer.startAsInitiator();
    });
    // 对端离开（如刷新页面）：进入宽限等待其重新加入，超时才收尾。
    sig.on('peer-left', () => startGrace());
    sig.on('signal', async (_from, payload) => {
      const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
      if (p.sdp) await peer?.acceptAnswer(p.sdp);
      else if (p.candidate) await peer?.addCandidate(p.candidate);
    });
  } else {
    sig.on('open', () => sig.joinRoom(init.roomId));
    // 对端离开（如刷新页面）：进入宽限等待其重连，超时才收尾。
    sig.on('peer-left', () => startGrace());
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
    startScreenShare: () => conv.startScreenShare(),
    stopScreenShare: () => conv.stopScreenShare(),
    setMicEnabled: e => peer?.setMicEnabled(e),
    close: teardown,
  };
}
