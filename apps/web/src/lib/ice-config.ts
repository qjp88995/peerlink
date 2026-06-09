export interface IceConfigEnv {
  VITE_STUN_URLS?: string;
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

/** 运行时注入的 ICE 配置（见 public/ice-config.js，生产由容器 entrypoint 生成）。 */
export interface RuntimeIceConfig {
  stunUrls?: string;
  turnUrl?: string;
  turnUsername?: string;
  turnCredential?: string;
}

// 国内可达的公共 STUN（Google 的在部分网络不可达）。多填几个由浏览器自行择优。
const DEFAULT_STUN = 'stun:stun.miwifi.com:3478,stun:stun.qq.com:3478';

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

/**
 * 运行时入口。优先用运行时注入的 `window.__PEERLINK_ICE__`（改服务器环境变量 +
 * 重启容器即可，无需重建镜像），其值为空时回退到构建期的 `import.meta.env`，
 * 再回退到 DEFAULT_STUN。
 */
export function iceServersFromEnv(): RTCIceServer[] {
  const rt =
    typeof window !== 'undefined' ? window.__PEERLINK_ICE__ : undefined;
  if (rt && (rt.stunUrls?.trim() || rt.turnUrl?.trim())) {
    return buildIceServers({
      VITE_STUN_URLS: rt.stunUrls,
      VITE_TURN_URL: rt.turnUrl,
      VITE_TURN_USERNAME: rt.turnUsername,
      VITE_TURN_CREDENTIAL: rt.turnCredential,
    });
  }
  return buildIceServers(import.meta.env);
}
