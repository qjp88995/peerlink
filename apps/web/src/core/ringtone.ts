export type RingKind = 'incoming' | 'ringback';

interface Pattern {
  /** 同时发声的频率（Hz），多频叠加更接近电话铃。 */
  freqs: number[];
  /** 单次响铃时长（毫秒）。 */
  onMs: number;
  /** 响铃间隔静音时长（毫秒）。 */
  offMs: number;
}

// 来电铃偏亮、节奏快；主叫回铃偏低、节奏慢——两端音色可区分。
const PATTERNS: Record<RingKind, Pattern> = {
  incoming: { freqs: [480, 620], onMs: 800, offMs: 1600 },
  ringback: { freqs: [440, 480], onMs: 1200, offMs: 3000 },
};

export interface RingtoneOptions {
  createContext?: () => AudioContext | undefined;
}

/** WebAudio 合成的电话铃声：start(kind) 循环播放，stop 停止。零资源文件。 */
export class Ringtone {
  private ctx?: AudioContext;
  private timer?: ReturnType<typeof setTimeout>;
  private kind: RingKind | null = null;
  private make: () => AudioContext | undefined;

  constructor(opts: RingtoneOptions = {}) {
    this.make = opts.createContext ?? defaultContext;
  }

  start(kind: RingKind): void {
    if (this.kind === kind) return;
    this.stop();
    if (!this.ctx) this.ctx = this.make();
    if (!this.ctx) return;
    void this.ctx.resume?.()?.catch?.(() => {});
    this.kind = kind;
    this.loop(PATTERNS[kind]);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.kind = null;
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close?.()?.catch?.(() => {});
    this.ctx = undefined;
  }

  private loop(p: Pattern): void {
    this.burst(p);
    this.timer = setTimeout(() => this.loop(p), p.onMs + p.offMs);
  }

  private burst(p: Pattern): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const t1 = t0 + p.onMs / 1000;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // 起落各 40ms 渐变，避免爆音。
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.16, t0 + 0.04);
    gain.gain.setValueAtTime(0.16, t1 - 0.04);
    gain.gain.linearRampToValueAtTime(0.0001, t1);
    for (const f of p.freqs) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(gain);
      o.start(t0);
      o.stop(t1);
    }
  }
}

function defaultContext(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Ctx ? new Ctx() : undefined;
}
