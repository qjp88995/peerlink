export type ScreenState = 'none' | 'local' | 'remote';

export type ScreenControl =
  | { type: 'screen-start'; callId: number }
  | { type: 'screen-stop'; callId: number };

export type ScreenError = 'permission-denied' | 'unsupported';

export interface ScreenShareDeps {
  isInitiator: boolean;
  sendControl: (m: ScreenControl) => void;
  acquireDisplay: () => Promise<MediaStream>;
  setScreenTrack: (track: MediaStreamTrack) => void;
  prepareRecvVideo: () => void;
  clearScreenTrack: () => void;
  renegotiate: () => Promise<void>;
  /** 取 call-session 当前 callId；不在会议中为 null。 */
  getCallId: () => number | null;
  callbacks: {
    onStateChange?: (state: ScreenState) => void;
    onLocalStream?: (stream: MediaStream | null) => void;
    onError?: (reason: ScreenError) => void;
  };
}

/** 纯逻辑屏幕共享状态机：一次一个演示者，固定 initiator 端 renegotiation。 */
export class ScreenShare {
  state: ScreenState = 'none';
  private localStream: MediaStream | null = null;

  constructor(private d: ScreenShareDeps) {}

  /** 本端发起共享。 */
  async start(): Promise<void> {
    if (this.state !== 'none') return;
    const callId = this.d.getCallId();
    if (callId === null) return;
    let stream: MediaStream;
    try {
      stream = await this.d.acquireDisplay();
    } catch (err) {
      this.d.callbacks.onError?.(reasonOf(err));
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopStream(stream);
      this.d.callbacks.onError?.('unsupported');
      return;
    }
    this.localStream = stream;
    track.addEventListener('ended', this.onTrackEnded);
    this.d.setScreenTrack(track);
    this.setState('local');
    this.d.callbacks.onLocalStream?.(stream);
    this.d.sendControl({ type: 'screen-start', callId });
    if (this.d.isInitiator) await this.d.renegotiate();
  }

  /** 本端停止共享。 */
  async stop(): Promise<void> {
    if (this.state !== 'local') return;
    const callId = this.d.getCallId();
    this.teardownLocal();
    this.d.clearScreenTrack();
    this.setState('none');
    if (callId !== null) this.d.sendControl({ type: 'screen-stop', callId });
    if (this.d.isInitiator) await this.d.renegotiate();
  }

  /** 处理对端屏幕控制帧。 */
  async onControl(msg: ScreenControl): Promise<void> {
    if (msg.type === 'screen-start') {
      if (this.state !== 'none') return; // 已有人演示，忽略（按钮侧已置灰）
      this.setState('remote');
      if (this.d.isInitiator) {
        this.d.prepareRecvVideo();
        await this.d.renegotiate();
      }
      return;
    }
    // screen-stop
    if (this.state !== 'remote') return;
    this.d.clearScreenTrack();
    this.setState('none');
    if (this.d.isInitiator) await this.d.renegotiate();
  }

  /** 会议结束/对端离开：强制复位（不发控制帧、不 renegotiate）。 */
  dispose(): void {
    if (this.state === 'local') this.teardownLocal();
    if (this.state !== 'none') {
      this.d.clearScreenTrack();
      this.setState('none');
    }
  }

  private onTrackEnded = (): void => {
    void this.stop();
  };

  private teardownLocal(): void {
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) {
        t.removeEventListener('ended', this.onTrackEnded);
        t.stop();
      }
      this.localStream = null;
    }
    this.d.callbacks.onLocalStream?.(null);
  }

  private setState(s: ScreenState): void {
    this.state = s;
    this.d.callbacks.onStateChange?.(s);
  }
}

function reasonOf(err: unknown): ScreenError {
  return (err as { name?: string })?.name === 'NotAllowedError'
    ? 'permission-denied'
    : 'unsupported';
}

function stopStream(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}
