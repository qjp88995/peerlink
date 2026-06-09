export interface SignalingConfig {
  port: number;
  /** WebSocket 路径，经 Traefik 反代到 /signal。 */
  path: string;
  /** 房间无人加入的存活时间（毫秒）。 */
  roomTtlMs: number;
  /** 回收任务的轮询间隔（毫秒）。 */
  reapIntervalMs: number;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env
): SignalingConfig {
  return {
    port: Number(env.SIGNALING_PORT ?? 3001),
    path: env.SIGNALING_PATH ?? '/signal',
    roomTtlMs: Number(env.ROOM_TTL_MS ?? 10 * 60 * 1000),
    reapIntervalMs: Number(env.REAP_INTERVAL_MS ?? 30 * 1000),
  };
}
