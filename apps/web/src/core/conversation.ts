import {
  controlMessageSchema,
  decodeFrame,
  encodeControlFrame,
  type FileEntry,
} from '@peerlink/protocol';

import { iceServersFromEnv } from '../lib/ice-config';
import { throttleProgress } from '../lib/progress-throttle';
import { rtcSendChannel, type SendChannel } from './channel';
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

  constructor(deps: ConversationDeps) {
    this.channel = deps.channel;
    this.makeWriter = deps.makeWriter;
    this.cb = deps.callbacks;
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
  }
}

function signalUrl(): string {
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
  acceptTransfer: (transferId: string) => Promise<void>;
  rejectTransfer: (transferId: string) => void;
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
      onStateChange: state => {
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
    acceptTransfer: t => conv.acceptTransfer(t),
    rejectTransfer: t => conv.rejectTransfer(t),
    close: teardown,
  };
}
