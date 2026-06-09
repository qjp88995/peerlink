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
