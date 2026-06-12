import { MAX_VOICE_DURATION_MS } from '@peerlink/protocol';

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
];

/** 选最佳受支持的录音 mimeType；都不支持返回 undefined（用浏览器默认）。 */
export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
}

/** 当前环境是否支持语音录制。 */
export function isVoiceSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** 单条语音录制：start → stop/cancel。60 秒自动停止。 */
export class VoiceRecorder {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mimeType = '';
  private capTimer?: ReturnType<typeof setTimeout>;
  private settle?: (r: RecordingResult) => void;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = pickMimeType();
    this.recorder = type
      ? new MediaRecorder(this.stream, { mimeType: type })
      : new MediaRecorder(this.stream);
    this.mimeType = this.recorder.mimeType || type || 'audio/webm';
    this.chunks = [];
    this.recorder.ondataavailable = e => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => this.finalize();
    this.startedAt = Date.now();
    this.recorder.start();
    this.capTimer = setTimeout(() => {
      void this.stop().catch(() => {});
    }, MAX_VOICE_DURATION_MS);
  }

  stop(): Promise<RecordingResult> {
    return new Promise((resolve, reject) => {
      if (!this.recorder) {
        reject(new Error('not recording'));
        return;
      }
      this.settle = resolve;
      this.clearCap();
      this.recorder.stop();
    });
  }

  cancel(): void {
    this.clearCap();
    this.settle = undefined;
    try {
      this.recorder?.stop();
    } catch {
      /* 已停止则忽略 */
    }
    this.recorder = undefined;
    this.chunks = [];
    this.releaseStream();
  }

  private finalize(): void {
    const durationMs = Date.now() - this.startedAt;
    const blob = new Blob(this.chunks, { type: this.mimeType });
    this.releaseStream();
    const settle = this.settle;
    this.settle = undefined;
    this.recorder = undefined;
    settle?.({ blob, mimeType: this.mimeType, durationMs });
  }

  private clearCap(): void {
    if (this.capTimer !== undefined) {
      clearTimeout(this.capTimer);
      this.capTimer = undefined;
    }
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = undefined;
  }
}
