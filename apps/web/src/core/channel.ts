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
      return new Promise(resolve => {
        dc.bufferedAmountLowThreshold = threshold;
        const handler = () => {
          dc.removeEventListener('bufferedamountlow', handler);
          resolve();
        };
        dc.addEventListener('bufferedamountlow', handler);
      });
    },
  };
}
