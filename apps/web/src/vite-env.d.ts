/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STUN_URLS?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  readonly VITE_SIGNAL_PATH?: string;
  readonly VITE_SIGNAL_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** 运行时 ICE 配置，由 /ice-config.js 注入（生产经容器 entrypoint 按环境变量生成）。 */
  __PEERLINK_ICE__?: import('@/lib/ice-config').RuntimeIceConfig;
}
