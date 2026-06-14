import { readFileSync, writeFileSync } from 'node:fs';

import { normalizeSignalDomain } from './signal-url';

export const DEFAULT_SIGNAL_URL = 'wss://peerlink.qinjiapeng.com/signal';

export interface IceConfig {
  stunUrls?: string;
  turnUrl?: string;
  turnUsername?: string;
  turnCredential?: string;
}

export interface PeerlinkConfig {
  signalUrl: string;
  ice: IceConfig;
}

const DEFAULTS: PeerlinkConfig = { signalUrl: DEFAULT_SIGNAL_URL, ice: {} };

export class ConfigStore {
  private config: PeerlinkConfig;

  constructor(private readonly file: string) {
    this.config = this.load();
  }

  get(): PeerlinkConfig {
    return this.config;
  }

  setSignalDomain(domain: string): void {
    this.config = { ...this.config, signalUrl: normalizeSignalDomain(domain) };
    this.persist();
  }

  setIce(ice: IceConfig): void {
    this.config = { ...this.config, ice };
    this.persist();
  }

  private load(): PeerlinkConfig {
    try {
      const raw = JSON.parse(
        readFileSync(this.file, 'utf8')
      ) as Partial<PeerlinkConfig>;
      return {
        signalUrl: raw.signalUrl ?? DEFAULTS.signalUrl,
        ice: raw.ice ?? {},
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.config, null, 2), 'utf8');
  }
}
