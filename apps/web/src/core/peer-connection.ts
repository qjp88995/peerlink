import { DATA_CHANNEL_LABEL } from '@peerlink/protocol';

export interface PeerConnectionOptions {
  iceServers: RTCIceServer[];
  createPc?: (config: RTCConfiguration) => RTCPeerConnection;
  onChannelOpen?: (dc: RTCDataChannel) => void;
  onMessage?: (data: Uint8Array) => void;
  onSignal?: (payload: {
    sdp?: string;
    candidate?: RTCIceCandidateInit;
  }) => void;
  onStateChange?: (state: RTCIceConnectionState) => void;
  onRemoteTrack?: (track: MediaStreamTrack) => void;
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private localSenders: RTCRtpSender[] = [];
  private videoTransceiver?: RTCRtpTransceiver;

  constructor(private opts: PeerConnectionOptions) {
    const create = opts.createPc ?? (cfg => new RTCPeerConnection(cfg));
    this.pc = create({ iceServers: opts.iceServers });

    this.pc.addEventListener('icecandidate', evt => {
      const e = evt as RTCPeerConnectionIceEvent;
      if (e.candidate) {
        opts.onSignal?.({ candidate: e.candidate.toJSON() });
      }
    });
    this.pc.addEventListener('iceconnectionstatechange', () => {
      opts.onStateChange?.(this.pc.iceConnectionState);
    });
    this.pc.addEventListener('datachannel', evt => {
      this.bindChannel((evt as RTCDataChannelEvent).channel);
    });
    this.pc.addEventListener('track', evt => {
      opts.onRemoteTrack?.((evt as RTCTrackEvent).track);
    });
  }

  async startAsInitiator(): Promise<void> {
    this.bindChannel(this.pc.createDataChannel(DATA_CHANNEL_LABEL));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.opts.onSignal?.({ sdp: offer.sdp });
  }

  async acceptOffer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.opts.onSignal?.({ sdp: answer.sdp });
  }

  async acceptAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  async addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.pc.addIceCandidate(candidate);
  }

  addLocalAudio(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      this.localSenders.push(this.pc.addTrack(track, stream));
    }
  }

  removeLocalAudio(): void {
    for (const sender of this.localSenders) {
      try {
        this.pc.removeTrack(sender);
      } catch {
        /* 已移除/已关闭则忽略 */
      }
    }
    this.localSenders = [];
  }

  /** 切换本地麦克风轨的启用状态（静音/取消静音）。 */
  setMicEnabled(enabled: boolean): void {
    for (const sender of this.localSenders) {
      if (sender.track) sender.track.enabled = enabled;
    }
  }

  private ensureVideoTransceiver(): RTCRtpTransceiver {
    if (!this.videoTransceiver) {
      this.videoTransceiver = this.pc.addTransceiver('video', {
        direction: 'inactive',
      });
    }
    return this.videoTransceiver;
  }

  /** 我开始演示：挂上屏幕视频轨，方向 sendonly。 */
  setScreenTrack(track: MediaStreamTrack): void {
    const tr = this.ensureVideoTransceiver();
    void tr.sender.replaceTrack(track);
    tr.direction = 'sendonly';
  }

  /** 对方要演示前（仅原始 initiator 调）：预置 recvonly 收口。 */
  prepareRecvVideo(): void {
    this.ensureVideoTransceiver().direction = 'recvonly';
  }

  /** 停止演示（任意一方）：卸轨，方向 inactive（保留同一条 m-line 复用）。 */
  clearScreenTrack(): void {
    if (!this.videoTransceiver) return;
    void this.videoTransceiver.sender.replaceTrack(null);
    this.videoTransceiver.direction = 'inactive';
  }

  /** 仅由原始 initiator 调用：发起一轮新的 offer/answer 协商。 */
  async renegotiate(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.opts.onSignal?.({ sdp: offer.sdp });
  }

  get channel(): RTCDataChannel | undefined {
    return this.dc;
  }

  close(): void {
    this.dc?.close();
    this.pc.close();
  }

  private bindChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.addEventListener('open', () => this.opts.onChannelOpen?.(dc));
    dc.addEventListener('message', evt => {
      const data = (evt as MessageEvent).data as ArrayBuffer;
      this.opts.onMessage?.(new Uint8Array(data));
    });
  }
}
