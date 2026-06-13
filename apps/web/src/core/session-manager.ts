import type { FileEntry } from '@peerlink/protocol';

import type { CallDir, CallRecord, CallState } from './call-session';
import {
  type Connection,
  type ConversationCallbacks,
  type ConversationHandle,
  startConversation as defaultStart,
  type TextItem,
} from './conversation';
import { type RingKind, Ringtone } from './ringtone';
import type { ScreenState } from './screen-share';

export interface SessionStore {
  addSession(id: string, roomId: string | null): void;
  removeSession(id: string): void;
  setActive(id: string): void;
  setRoom(id: string, roomId: string): void;
  setConnection(id: string, connection: Connection): void;
  appendText(id: string, item: TextItem): void;
  appendIncomingFiles(
    id: string,
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ): void;
  appendOutgoingFiles(
    id: string,
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ): void;
  updateFileStatus(
    id: string,
    transferId: string,
    status: 'transferring' | 'done' | 'failed' | 'rejected'
  ): void;
  updateFileProgress(id: string, transferId: string, sent: number): void;
  appendOutgoingVoice(
    id: string,
    msgId: string,
    durationMs: number,
    size: number
  ): void;
  appendIncomingVoice(
    id: string,
    msgId: string,
    durationMs: number,
    size: number
  ): void;
  setVoiceReady(id: string, msgId: string, url: string): void;
  setVoiceFailed(id: string, msgId: string): void;
  setCallState(id: string, state: CallState, dir: CallDir | null): void;
  setCallError(id: string, error: string | undefined): void;
  setCallMuted(id: string, muted: boolean): void;
  setScreenState(id: string, screen: ScreenState): void;
  bumpScreen(id: string): void;
  appendCallRecord(id: string, record: CallRecord): void;
}

export interface SessionManagerDeps {
  store: SessionStore;
  start?: typeof defaultStart;
  genId?: () => string;
  onConnectionChange?: (id: string, state: Connection) => void;
}

/** 并行持有多个 P2P 会话，把每条会话的回调路由到 store。 */
export class SessionManager {
  private handles = new Map<string, ConversationHandle>();
  private rooms = new Map<string, string>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private localScreens = new Map<string, MediaStream>();
  private remoteScreens = new Map<string, MediaStream>();
  private ringtone = new Ringtone();
  private ringingId: string | null = null;
  private store: SessionStore;
  private start: typeof defaultStart;
  private genId: () => string;
  private onConnectionChange?: (id: string, state: Connection) => void;

  constructor(deps: SessionManagerDeps) {
    this.store = deps.store;
    this.start = deps.start ?? defaultStart;
    this.genId = deps.genId ?? (() => crypto.randomUUID());
    this.onConnectionChange = deps.onConnectionChange;
  }

  create(): string {
    const id = this.genId();
    this.store.addSession(id, null);
    this.handles.set(id, this.start({ mode: 'create' }, this.callbacks(id)));
    return id;
  }

  join(roomId: string): string {
    for (const [id, room] of this.rooms) {
      if (room === roomId && this.handles.has(id)) {
        this.store.setActive(id);
        return id;
      }
    }
    const id = this.genId();
    this.rooms.set(id, roomId);
    this.store.addSession(id, roomId);
    this.handles.set(
      id,
      this.start({ mode: 'join', roomId }, this.callbacks(id))
    );
    return id;
  }

  remove(id: string): void {
    this.handles.get(id)?.close();
    if (this.ringingId === id) {
      this.ringingId = null;
      this.ringtone.stop();
    }
    this.stopRemote(id);
    this.handles.delete(id);
    this.rooms.delete(id);
    this.store.removeSession(id);
  }

  sendText(id: string, text: string): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    this.store.appendText(id, handle.sendText(text));
  }

  sendFiles(id: string, files: File[]): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    const out = handle.sendFiles(files);
    this.store.appendOutgoingFiles(
      id,
      out.transferId,
      out.entries,
      out.totalSize
    );
  }

  async sendVoice(
    id: string,
    blob: Blob,
    mimeType: string,
    durationMs: number
  ): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) return;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch {
      return;
    }
    const { item, done } = handle.sendVoice(bytes, mimeType, durationMs);
    this.store.appendOutgoingVoice(id, item.id, item.durationMs, item.size);
    done
      .then(() => {
        const url = URL.createObjectURL(
          new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
        );
        if (this.handles.has(id)) {
          this.store.setVoiceReady(id, item.id, url);
        } else {
          URL.revokeObjectURL(url);
        }
      })
      .catch(() => this.store.setVoiceFailed(id, item.id));
  }

  dialCall(id: string): void {
    void this.handles.get(id)?.dialCall();
  }

  acceptCall(id: string): void {
    void this.handles.get(id)?.acceptCall();
  }

  rejectCall(id: string): void {
    this.handles.get(id)?.rejectCall();
  }

  hangupCall(id: string): void {
    this.handles.get(id)?.hangupCall();
  }

  toggleMute(id: string, muted: boolean): void {
    this.handles.get(id)?.setMicEnabled(!muted);
    this.store.setCallMuted(id, muted);
  }

  startScreenShare(id: string): void {
    void this.handles.get(id)?.startScreenShare();
  }

  stopScreenShare(id: string): void {
    void this.handles.get(id)?.stopScreenShare();
  }

  /** 当前应展示的屏幕流：本端演示给本地预览，对端演示给远端画面。 */
  getScreenStream(id: string): MediaStream | null {
    return this.localScreens.get(id) ?? this.remoteScreens.get(id) ?? null;
  }

  private playRemote(id: string, track: MediaStreamTrack): void {
    let el = this.audioEls.get(id);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      this.audioEls.set(id, el);
    }
    el.srcObject = new MediaStream([track]);
    void el.play?.().catch(() => {});
  }

  private stopRemote(id: string): void {
    const el = this.audioEls.get(id);
    if (el) {
      el.srcObject = null;
      this.audioEls.delete(id);
    }
  }

  private clearScreens(id: string): void {
    this.localScreens.delete(id);
    const rs = this.remoteScreens.get(id);
    if (rs) {
      for (const t of rs.getTracks()) t.stop();
      this.remoteScreens.delete(id);
    }
  }

  // 来电(ringing/in) 播来电铃，拨号(dialing) 播回铃；接通/结束停。
  // 仅响铃所属会话能停铃，避免别的会话状态变化误停。
  private updateRing(id: string, state: CallState, dir: CallDir | null): void {
    const kind: RingKind | null =
      state === 'ringing' && dir === 'in'
        ? 'incoming'
        : state === 'dialing'
          ? 'ringback'
          : null;
    if (kind) {
      this.ringingId = id;
      this.ringtone.start(kind);
    } else if (this.ringingId === id) {
      this.ringingId = null;
      this.ringtone.stop();
    }
  }

  acceptTransfer(id: string, transferId: string): void {
    void this.handles.get(id)?.acceptTransfer(transferId);
  }

  rejectTransfer(id: string, transferId: string): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.rejectTransfer(transferId);
    this.store.updateFileStatus(id, transferId, 'rejected');
  }

  closeAll(): void {
    for (const handle of this.handles.values()) handle.close();
    for (const id of [...this.audioEls.keys()]) this.stopRemote(id);
    for (const id of [...this.remoteScreens.keys()]) this.clearScreens(id);
    this.localScreens.clear();
    this.ringingId = null;
    this.ringtone.dispose();
    this.handles.clear();
    this.rooms.clear();
  }

  private callbacks(id: string): ConversationCallbacks {
    return {
      onRoom: roomId => {
        this.rooms.set(id, roomId);
        this.store.setRoom(id, roomId);
      },
      onConnection: state => {
        this.store.setConnection(id, state);
        this.onConnectionChange?.(id, state);
      },
      onText: item => this.store.appendText(id, item),
      onIncomingFiles: (transferId, files, total) =>
        this.store.appendIncomingFiles(id, transferId, files, total),
      onTransferStart: transferId =>
        this.store.updateFileStatus(id, transferId, 'transferring'),
      onProgress: (transferId, sent) =>
        this.store.updateFileProgress(id, transferId, sent),
      onTransferDone: transferId =>
        this.store.updateFileStatus(id, transferId, 'done'),
      onTransferFailed: transferId =>
        this.store.updateFileStatus(id, transferId, 'failed'),
      onTransferRejected: transferId =>
        this.store.updateFileStatus(id, transferId, 'rejected'),
      onVoiceStart: (msgId, durationMs, totalSize) =>
        this.store.appendIncomingVoice(id, msgId, durationMs, totalSize),
      onVoiceReady: (msgId, bytes, mimeType) =>
        this.store.setVoiceReady(
          id,
          msgId,
          URL.createObjectURL(
            new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
          )
        ),
      onVoiceFailed: msgId => this.store.setVoiceFailed(id, msgId),
      onCallStateChange: (state, dir) => {
        this.store.setCallState(id, state, dir);
        this.updateRing(id, state, dir);
        if (state === 'idle') {
          this.stopRemote(id);
          this.store.setScreenState(id, 'none');
          this.clearScreens(id);
        }
      },
      onCallError: reason => this.store.setCallError(id, reason),
      onCallEnded: record => this.store.appendCallRecord(id, record),
      onRemoteAudioTrack: track => this.playRemote(id, track),
      onScreenStateChange: state => {
        this.store.setScreenState(id, state);
        if (state === 'none') this.clearScreens(id);
      },
      onLocalScreenStream: stream => {
        if (stream) this.localScreens.set(id, stream);
        else this.localScreens.delete(id);
        this.store.bumpScreen(id);
      },
      onRemoteScreenTrack: track => {
        this.remoteScreens.set(id, new MediaStream([track]));
        // 流存入非响应式 Map，须显式通知 store 触发重渲染、绑定 video。
        this.store.bumpScreen(id);
      },
      onScreenError: () => {
        // 共享失败（取消/无权限）：状态由模块回到 none，此处可选 toast。
      },
    };
  }
}
