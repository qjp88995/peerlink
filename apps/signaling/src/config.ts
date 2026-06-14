export interface SignalingConfig {
  port: number;
  /** WebSocket 路径，经 Traefik 反代到 /signal。 */
  path: string;
  /** 房间无人加入的存活时间（毫秒）。 */
  roomTtlMs: number;
  /** 回收任务的轮询间隔（毫秒）。 */
  reapIntervalMs: number;
  /** 单条 WebSocket 消息的最大字节数，超出即由 ws 关闭连接（防内存放大）。 */
  maxPayloadBytes: number;
  /**
   * 允许的浏览器 Origin 白名单；为 null 时放行任意来源（局域网/开发）。
   * 公网部署应经 ALLOWED_ORIGINS 显式收敛。
   */
  allowedOrigins: string[] | null;
  /** 心跳 ping 间隔（毫秒）：连续两次无 pong 的连接会被回收。 */
  heartbeatIntervalMs: number;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env
): SignalingConfig {
  const origins = env.ALLOWED_ORIGINS?.split(',')
    .map(o => o.trim())
    .filter(Boolean);
  return {
    port: Number(env.SIGNALING_PORT ?? 3001),
    path: env.SIGNALING_PATH ?? '/signal',
    roomTtlMs: Number(env.ROOM_TTL_MS ?? 10 * 60 * 1000),
    reapIntervalMs: Number(env.REAP_INTERVAL_MS ?? 30 * 1000),
    maxPayloadBytes: Number(env.MAX_PAYLOAD_BYTES ?? 1024 * 1024),
    allowedOrigins: origins && origins.length > 0 ? origins : null,
    heartbeatIntervalMs: Number(env.HEARTBEAT_INTERVAL_MS ?? 30 * 1000),
  };
}
