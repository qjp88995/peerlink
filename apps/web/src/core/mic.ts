import type { CallRejectReason } from '@peerlink/protocol';

/** 取麦克风失败时抛出，reason 与 call-reject 的 reason 对齐。 */
export class MicError extends Error {
  constructor(readonly reason: CallRejectReason) {
    super(reason);
    this.name = 'MicError';
  }
}

/** 申请麦克风音频流；失败抛 MicError，reason ∈ unsupported|permission-denied|no-mic。 */
export async function acquireMic(): Promise<MediaStream> {
  const md =
    typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) throw new MicError('unsupported');
  try {
    // 显式开启声学回音消除（AEC）+ 降噪 + 自动增益：公放时浏览器以远端外放信号
    // 为参考，从麦克风采集中减去回声，避免对端听到自己的回音。
    return await md.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MicError('permission-denied');
    }
    throw new MicError('no-mic');
  }
}
