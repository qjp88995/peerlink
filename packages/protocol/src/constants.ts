/**
 * 默认数据块大小（字节）。48 KB：加上 data 帧头后整帧仍 < 64 KB，跨浏览器安全，
 * 同时比 16 KB 显著减少分片数（更少的读盘 / 发送 / 进度上报开销）。
 */
export const DEFAULT_CHUNK_SIZE = 48 * 1024;

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

/** 单条语音消息最大录音时长（毫秒）。 */
export const MAX_VOICE_DURATION_MS = 60 * 1000;

/** 呼叫振铃无应答超时（毫秒）。 */
export const CALL_RING_TIMEOUT_MS = 30 * 1000;

/** 通话中 ICE 断连自愈宽限期（毫秒）。 */
export const CALL_GRACE_MS = 8 * 1000;
