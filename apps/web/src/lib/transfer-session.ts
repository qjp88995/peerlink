import { type FileEntry } from '@peerlink/protocol';

import { rtcSendChannel } from '@/core/channel';
import { PeerConnection } from '@/core/peer-connection';
import { TransferReceiver } from '@/core/receiver';
import {
  browserFileToSource,
  buildManifest,
  TransferSender,
} from '@/core/sender';
import { SignalingClient } from '@/core/signaling-client';
import { BlobWriter } from '@/core/storage/blob-writer';
import { FsAccessWriter } from '@/core/storage/fs-access-writer';
import {
  chooseWriterKind,
  detectCapabilities,
  manifestHasDirectory,
  type Writer,
} from '@/core/storage/writer';
import { FolderZipWriter } from '@/core/storage/zip-writer';
import { iceServersFromEnv } from '@/lib/ice-config';

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

export interface SessionCallbacks {
  onPhase: (p: 'connecting' | 'transferring' | 'done' | 'error') => void;
  onManifest?: (files: FileEntry[]) => void;
  onProgress?: (received: number, total: number) => void;
  onRoom?: (roomId: string) => void;
  onError?: (msg: string) => void;
}

/** 发送会话：建房 → 等对端 → 发 manifest → 收到 accept 后流式发送。 */
export function startSendSession(files: File[], cb: SessionCallbacks) {
  const sig = new SignalingClient(signalUrl());
  const sources = files.map((f, i) => browserFileToSource(f, i));
  const manifest = buildManifest(sources);
  let peer: PeerConnection | undefined;
  let targetPeerId: string | undefined;

  const send = (payload: object) =>
    targetPeerId &&
    sig.signal(targetPeerId, payload as Record<string, unknown>);

  sig.on('open', () => sig.createRoom());
  sig.on('room-created', roomId => cb.onRoom?.(roomId));
  sig.on('error', (_c, m) => cb.onError?.(m));
  sig.on('peer-joined', async peerId => {
    targetPeerId = peerId;
    cb.onPhase('connecting');
    peer = new PeerConnection({
      iceServers: iceServersFromEnv(),
      onSignal: send,
      onChannelOpen: dc => {
        // 通道打开后立即发送 manifest（控制帧）
        void import('@peerlink/protocol').then(({ encodeControlFrame }) => {
          dc.send(encodeControlFrame(manifest) as ArrayBufferView<ArrayBuffer>);
        });
      },
      onMessage: async bytes => {
        const { decodeFrame, controlMessageSchema } =
          await import('@peerlink/protocol');
        const frame = decodeFrame(bytes);
        if (frame.kind !== 'control') return;
        const msg = controlMessageSchema.parse(frame.message);
        if (msg.type === 'reject') return cb.onError?.('对方已拒绝');
        if (msg.type === 'accept' && peer?.channel) {
          cb.onPhase('transferring');
          const sender = new TransferSender(
            rtcSendChannel(peer.channel),
            sources,
            { onProgress: cb.onProgress }
          );
          await sender.streamAll();
          cb.onPhase('done');
        }
      },
    });
    await peer.startAsInitiator();
  });
  sig.on('signal', async (_from, payload) => {
    const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
    if (p.sdp) await peer?.acceptAnswer(p.sdp);
    else if (p.candidate) await peer?.addCandidate(p.candidate);
  });

  return {
    cancel() {
      peer?.close();
      sig.close();
    },
  };
}

function makeWriter(files: FileEntry[]): Promise<Writer> {
  const caps = detectCapabilities();
  const hasDirectory = manifestHasDirectory(files);
  const kind = chooseWriterKind(caps, {
    fileCount: files.length,
    hasDirectory,
  });
  if (kind === 'fs-access') {
    return window.showDirectoryPicker!().then(
      root => new FsAccessWriter({ files }, root)
    );
  }
  if (kind === 'zip') {
    return Promise.resolve(
      new FolderZipWriter({ files }, blob =>
        triggerDownload('peerlink.zip', blob)
      )
    );
  }
  return Promise.resolve(
    new BlobWriter(
      { files },
      { onFile: (name, blob) => triggerDownload(name, blob) }
    )
  );
}

/** 接收会话：进房 → 应答 offer → 收 manifest → 用户接受后接收。 */
export function startReceiveSession(roomId: string, cb: SessionCallbacks) {
  const sig = new SignalingClient(signalUrl());
  let peer: PeerConnection | undefined;
  let fromPeerId: string | undefined;
  let receiver: TransferReceiver | undefined;
  let manifestFiles: FileEntry[] | undefined;

  sig.on('open', () => sig.joinRoom(roomId));
  sig.on('error', (_c, m) => cb.onError?.(m));
  sig.on('signal', async (from, payload) => {
    fromPeerId = from;
    const p = payload as { sdp?: string; candidate?: RTCIceCandidateInit };
    if (!peer) {
      cb.onPhase('connecting');
      peer = new PeerConnection({
        iceServers: iceServersFromEnv(),
        onSignal: out => fromPeerId && sig.signal(fromPeerId, out),
        onMessage: async bytes => {
          const { decodeFrame, controlMessageSchema } =
            await import('@peerlink/protocol');
          if (!receiver) {
            const frame = decodeFrame(bytes);
            if (frame.kind === 'control') {
              const msg = controlMessageSchema.parse(frame.message);
              if (msg.type === 'manifest') {
                manifestFiles = msg.files;
                cb.onManifest?.(msg.files);
              }
            }
            return;
          }
          await receiver.handleFrame(bytes);
        },
      });
    }
    if (p.sdp) await peer.acceptOffer(p.sdp);
    else if (p.candidate) await peer.addCandidate(p.candidate);
  });

  return {
    async accept() {
      const { encodeControlFrame } = await import('@peerlink/protocol');
      if (!peer?.channel || !manifestFiles) return;
      const writer = await makeWriter(manifestFiles);
      const total = manifestFiles.reduce((s, f) => s + f.size, 0);
      receiver = new TransferReceiver(
        { type: 'manifest', files: manifestFiles, totalSize: total },
        writer,
        {
          onProgress: cb.onProgress,
          onComplete: () => cb.onPhase('done'),
        }
      );
      cb.onPhase('transferring');
      peer.channel.send(
        encodeControlFrame({ type: 'accept' }) as ArrayBufferView<ArrayBuffer>
      );
    },
    reject() {
      void import('@peerlink/protocol').then(({ encodeControlFrame }) => {
        peer?.channel?.send(
          encodeControlFrame({ type: 'reject' }) as ArrayBufferView<ArrayBuffer>
        );
        peer?.close();
        sig.close();
      });
    },
    cancel() {
      peer?.close();
      sig.close();
    },
  };
}
