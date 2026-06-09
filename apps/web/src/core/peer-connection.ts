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
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private dc?: RTCDataChannel;

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
