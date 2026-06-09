export interface IceConfigEnv {
  VITE_STUN_URLS?: string;
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

/** 由环境变量构建 ICE 服务器列表；TURN 可选（可插拔，留空仅用 STUN）。 */
export function buildIceServers(env: IceConfigEnv): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun = (env.VITE_STUN_URLS ?? DEFAULT_STUN)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (stun.length) servers.push({ urls: stun });
  if (env.VITE_TURN_URL && env.VITE_TURN_URL.trim()) {
    servers.push({
      urls: env.VITE_TURN_URL.trim(),
      username: env.VITE_TURN_USERNAME,
      credential: env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}

/** 运行时入口：从 import.meta.env 读取。 */
export function iceServersFromEnv(): RTCIceServer[] {
  return buildIceServers(import.meta.env);
}
