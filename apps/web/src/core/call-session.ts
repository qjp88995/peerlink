import {
  CALL_GRACE_MS,
  CALL_RING_TIMEOUT_MS,
  type CallEndReason,
  type CallRejectReason,
} from '@peerlink/protocol';

export type CallState =
  | 'idle'
  | 'dialing'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'reconnecting';

export type CallDir = 'out' | 'in';

/** 通话结束后落时间线的记录。 */
export interface CallRecord {
  dir: CallDir;
  /** 已接通过：通话时长（毫秒）。 */
  durationMs?: number;
  /** 未接通的结束原因。 */
  outcome?:
    | 'cancelled'
    | 'declined'
    | 'missed'
    | 'busy'
    | 'failed'
    | 'rejected';
}

export type CallControl =
  | { type: 'call-invite'; callId: number; ts: number }
  | { type: 'call-accept'; callId: number }
  | { type: 'call-reject'; callId: number; reason: CallRejectReason }
  | { type: 'call-end'; callId: number; reason: CallEndReason };

export interface CallSessionDeps {
  isInitiator: boolean;
  sendControl: (msg: CallControl) => void;
  acquireMic: () => Promise<MediaStream>;
  addLocalAudio: (stream: MediaStream) => void;
  removeLocalAudio: () => void;
  renegotiate: () => Promise<void>;
  genCallId: () => number;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  callbacks: {
    onStateChange?: (state: CallState, dir: CallDir | null) => void;
    onIncoming?: (callId: number) => void;
    /** 主叫本端能力/对端拒绝等失败原因（用于 toast）。 */
    onError?: (reason: CallRejectReason) => void;
    onEnded?: (record: CallRecord) => void;
  };
}

/** 纯逻辑通话状态机：编排单路语音通话的生命周期。 */
export class CallSession {
  state: CallState = 'idle';
  private dir: CallDir | null = null;
  private callId: number | null = null;
  private startedAt = 0;
  private ringTimer: unknown;
  private graceTimer: unknown;

  constructor(private d: CallSessionDeps) {}

  // ---- 本端动作 ----

  async dial(): Promise<void> {
    if (this.state !== 'idle') return;
    let stream: MediaStream;
    try {
      stream = await this.d.acquireMic();
    } catch (err) {
      this.d.callbacks.onError?.(reasonOf(err));
      return;
    }
    this.d.addLocalAudio(stream);
    this.callId = this.d.genCallId();
    this.dir = 'out';
    this.setState('dialing');
    this.d.sendControl({
      type: 'call-invite',
      callId: this.callId,
      ts: this.d.now(),
    });
    this.ringTimer = this.d.setTimeout(() => {
      if (this.callId !== null) {
        this.d.sendControl({
          type: 'call-end',
          callId: this.callId,
          reason: 'timeout',
        });
      }
      this.finish({ dir: 'out', outcome: 'missed' });
    }, CALL_RING_TIMEOUT_MS);
  }

  async accept(): Promise<void> {
    if (this.state !== 'ringing' || this.callId === null) return;
    const callId = this.callId;
    let stream: MediaStream;
    try {
      stream = await this.d.acquireMic();
    } catch (err) {
      this.d.sendControl({
        type: 'call-reject',
        callId,
        reason: reasonOf(err),
      });
      this.finish({ dir: 'in', outcome: 'declined' });
      return;
    }
    this.d.addLocalAudio(stream);
    this.setState('connecting');
    this.d.sendControl({ type: 'call-accept', callId });
    if (this.d.isInitiator) await this.d.renegotiate();
  }

  reject(): void {
    if (this.state !== 'ringing' || this.callId === null) return;
    this.d.sendControl({
      type: 'call-reject',
      callId: this.callId,
      reason: 'declined',
    });
    this.finish({ dir: 'in', outcome: 'declined' });
  }

  hangup(): void {
    if (this.state === 'idle') return;
    if (this.state === 'ringing') return this.reject();
    if (this.callId === null) return;
    if (this.state === 'dialing') {
      this.d.sendControl({
        type: 'call-end',
        callId: this.callId,
        reason: 'cancelled',
      });
      this.finish({ dir: 'out', outcome: 'cancelled' });
      return;
    }
    // connecting / active / reconnecting
    this.d.sendControl({
      type: 'call-end',
      callId: this.callId,
      reason: 'hangup',
    });
    this.finish(this.endRecord());
  }

  // ---- 远端控制消息 ----

  onControl(msg: CallControl): void {
    switch (msg.type) {
      case 'call-invite':
        return this.onInvite(msg.callId);
      case 'call-accept':
        if (this.state === 'dialing' && msg.callId === this.callId) {
          this.clearRing();
          this.setState('connecting');
          if (this.d.isInitiator) void this.d.renegotiate();
        }
        return;
      case 'call-reject':
        if (this.state === 'dialing' && msg.callId === this.callId) {
          this.d.callbacks.onError?.(msg.reason);
          this.finish({
            dir: 'out',
            outcome: msg.reason === 'busy' ? 'busy' : 'rejected',
          });
        }
        return;
      case 'call-end':
        if (
          this.callId !== null &&
          msg.callId === this.callId &&
          this.state !== 'idle'
        ) {
          this.finish(this.endRecord(msg.reason));
        }
        return;
    }
  }

  private onInvite(callId: number): void {
    if (this.state === 'idle') {
      this.startRinging(callId);
      return;
    }
    if (this.state === 'dialing' && !this.d.isInitiator) {
      // glare：让 initiator 一方的呼叫胜出，本端放弃自己的拨打转为振铃
      this.clearRing();
      this.startRinging(callId);
      return;
    }
    // 其余（含 initiator 的 dialing、connecting、active...）：忙线
    this.d.sendControl({ type: 'call-reject', callId, reason: 'busy' });
  }

  private startRinging(callId: number): void {
    this.callId = callId;
    this.dir = 'in';
    this.setState('ringing');
    this.d.callbacks.onIncoming?.(callId);
  }

  // ---- 媒体 / 连接事件 ----

  /** 收到对端音频轨：视为接通。 */
  onRemoteAudio(): void {
    if (this.state === 'connecting') {
      this.startedAt = this.d.now();
      this.setState('active');
    }
  }

  onConnectionState(state: RTCIceConnectionState): void {
    if (state === 'disconnected') {
      if (this.state === 'active') {
        this.setState('reconnecting');
        this.graceTimer = this.d.setTimeout(() => {
          if (this.callId !== null) {
            this.d.sendControl({
              type: 'call-end',
              callId: this.callId,
              reason: 'failed',
            });
          }
          this.finish(this.endRecord('failed'));
        }, CALL_GRACE_MS);
      }
      return;
    }
    if (state === 'connected' || state === 'completed') {
      if (this.state === 'reconnecting') {
        this.clearGrace();
        this.setState('active');
      }
      return;
    }
    if (state === 'failed' || state === 'closed') {
      if (this.state !== 'idle') this.finish(this.endRecord('failed'));
    }
  }

  /** 会话销毁/对端离开：强制收尾。 */
  dispose(): void {
    if (this.state !== 'idle') this.finish(this.endRecord('failed'));
  }

  // ---- 内部 ----

  private endRecord(reason?: CallEndReason): CallRecord {
    const dir = this.dir ?? 'out';
    if (this.state === 'active' || this.state === 'reconnecting') {
      return { dir, durationMs: this.d.now() - this.startedAt };
    }
    // 未接通
    if (this.state === 'ringing') return { dir, outcome: 'missed' };
    if (reason === 'failed') return { dir, outcome: 'failed' };
    return { dir, outcome: reason === 'cancelled' ? 'cancelled' : 'missed' };
  }

  private finish(record: CallRecord): void {
    this.clearRing();
    this.clearGrace();
    this.d.removeLocalAudio();
    this.callId = null;
    this.dir = null;
    this.startedAt = 0;
    this.setState('idle');
    this.d.callbacks.onEnded?.(record);
  }

  private setState(s: CallState): void {
    this.state = s;
    this.d.callbacks.onStateChange?.(s, s === 'idle' ? null : this.dir);
  }

  private clearRing(): void {
    if (this.ringTimer !== undefined) {
      this.d.clearTimeout(this.ringTimer);
      this.ringTimer = undefined;
    }
  }

  private clearGrace(): void {
    if (this.graceTimer !== undefined) {
      this.d.clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
    }
  }
}

function reasonOf(err: unknown): CallRejectReason {
  const r = (err as { reason?: CallRejectReason })?.reason;
  return r ?? 'no-mic';
}
