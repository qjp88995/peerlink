/** 默认数据块大小（字节）。16 KB 跨浏览器最安全。 */
export const DEFAULT_CHUNK_SIZE = 16 * 1024;

/** 探测到更大 maxMessageSize 时可提升到的上限（字节）。 */
export const MAX_CHUNK_SIZE = 64 * 1024;

/** 发送端缓冲高水位：超过则暂停发送（字节）。 */
export const BUFFER_HIGH_WATERMARK = 1024 * 1024;

/** 发送端缓冲低水位：降到此值以下恢复发送（字节）。 */
export const BUFFER_LOW_WATERMARK = 256 * 1024;

/** 房间无人加入的存活时间（毫秒）。 */
export const ROOM_TTL_MS = 10 * 60 * 1000;

/** DataChannel 标签名。 */
export const DATA_CHANNEL_LABEL = 'peerlink-transfer';
