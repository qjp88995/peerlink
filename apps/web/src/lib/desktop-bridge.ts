import type { RuntimeIceConfig } from './ice-config';

/** 配置变更事件载荷（主进程保存后推送）。 */
export interface BridgeConfig {
  signalUrl: string;
  signalDomain: string;
  ice: RuntimeIceConfig;
}

/** 通知类型：来消息 vs 来电。 */
export type NotifyKind = 'message' | 'call';

/** 桌面壳经 preload 注入的桥。浏览器中为 undefined。 */
export interface PeerlinkBridge {
  readonly signalUrl: string;
  readonly ice: RuntimeIceConfig;
  readonly signalDomain: string;
  setSignalDomain(domain: string): Promise<void>;
  setIce(ice: RuntimeIceConfig): Promise<void>;
  onConfigChange(cb: (cfg: BridgeConfig) => void): void;
  notify(payload: {
    title: string;
    body: string;
    kind: NotifyKind;
    sessionId: string;
  }): void;
  onActivateSession(cb: (sessionId: string) => void): void;
}

declare global {
  interface Window {
    peerlink?: PeerlinkBridge;
  }
}

export function getBridge(): PeerlinkBridge | undefined {
  return typeof window !== 'undefined' ? window.peerlink : undefined;
}

export function isDesktop(): boolean {
  return !!getBridge();
}

// ── 运行时配置 holder：保存设置后即时生效，避免 reload 摧毁会话/阅后即焚消息 ──
let currentSignalUrl: string | undefined = getBridge()?.signalUrl;
let currentIce: RuntimeIceConfig | undefined = getBridge()?.ice;
let wired = false;

function ensureWired(): void {
  const bridge = getBridge();
  if (wired || typeof bridge?.onConfigChange !== 'function') return;
  wired = true;
  bridge.onConfigChange(cfg => {
    currentSignalUrl = cfg.signalUrl;
    currentIce = cfg.ice;
  });
}

/** 桌面端最新信令地址；浏览器返回 undefined。 */
export function getSignalUrl(): string | undefined {
  ensureWired();
  // holder 优先（onConfigChange 推送的最新值），否则回退到桥的启动值。
  return currentSignalUrl ?? getBridge()?.signalUrl;
}

/** 桌面端最新 ICE 配置；浏览器返回 undefined。 */
export function getRuntimeIce(): RuntimeIceConfig | undefined {
  ensureWired();
  return currentIce ?? getBridge()?.ice;
}
