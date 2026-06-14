export interface SendChannel {
  send(data: Uint8Array): void;
  /** 当前发送缓冲字节数。 */
  readonly bufferedAmount: number;
  /** 缓冲量降到 threshold 及以下时 resolve。 */
  waitForDrain(threshold: number): Promise<void>;
}

/** 基于真实 RTCDataChannel 的发送通道适配器。 */
export function rtcSendChannel(dc: RTCDataChannel): SendChannel {
  return {
    send(data) {
      dc.send(data as ArrayBufferView<ArrayBuffer>);
    },
    get bufferedAmount() {
      return dc.bufferedAmount;
    },
    waitForDrain(threshold) {
      if (dc.bufferedAmount <= threshold) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          dc.removeEventListener('bufferedamountlow', onDrain);
          dc.removeEventListener('close', onClose);
          dc.removeEventListener('error', onClose);
        };
        const onDrain = () => {
          cleanup();
          resolve();
        };
        // 通道在等待期间关闭/出错时 bufferedamountlow 永不再触发；
        // 必须 reject 解除发送方挂起（上层转 onTransferFailed），否则永久 hang。
        const onClose = () => {
          cleanup();
          reject(new Error('data channel closed while draining'));
        };
        dc.bufferedAmountLowThreshold = threshold;
        dc.addEventListener('bufferedamountlow', onDrain);
        dc.addEventListener('close', onClose);
        dc.addEventListener('error', onClose);
      });
    },
  };
}
