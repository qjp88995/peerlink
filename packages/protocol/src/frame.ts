export const FRAME_CONTROL = 0x00;
export const FRAME_DATA = 0x01;

const DATA_HEADER_BYTES = 1 + 4 + 4; // tag + fileId + chunkIndex

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 编码控制帧：`[0x00][UTF-8 JSON]`。 */
export function encodeControlFrame(message: unknown): Uint8Array {
  const json = encoder.encode(JSON.stringify(message));
  const out = new Uint8Array(1 + json.length);
  out[0] = FRAME_CONTROL;
  out.set(json, 1);
  return out;
}

/** 编码数据帧：`[0x01][fileId BE][chunkIndex BE][payload]`。 */
export function encodeDataFrame(
  fileId: number,
  chunkIndex: number,
  payload: Uint8Array
): Uint8Array {
  const out = new Uint8Array(DATA_HEADER_BYTES + payload.length);
  const view = new DataView(out.buffer);
  out[0] = FRAME_DATA;
  view.setUint32(1, fileId, false);
  view.setUint32(5, chunkIndex, false);
  out.set(payload, DATA_HEADER_BYTES);
  return out;
}

export type DecodedFrame =
  | { kind: 'control'; message: unknown }
  | {
      kind: 'data';
      fileId: number;
      chunkIndex: number;
      payload: Uint8Array;
    };

/** 解码任意帧。未知首字节抛错。 */
export function decodeFrame(bytes: Uint8Array): DecodedFrame {
  const tag = bytes[0];
  if (tag === FRAME_CONTROL) {
    const message = JSON.parse(decoder.decode(bytes.subarray(1)));
    return { kind: 'control', message };
  }
  if (tag === FRAME_DATA) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fileId = view.getUint32(1, false);
    const chunkIndex = view.getUint32(5, false);
    const payload = bytes.subarray(DATA_HEADER_BYTES);
    return { kind: 'data', fileId, chunkIndex, payload };
  }
  throw new Error(`Unknown frame tag: ${tag}`);
}
