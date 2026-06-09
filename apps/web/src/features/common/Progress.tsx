import { Check } from 'lucide-react';

import { formatBytes } from '@/lib/format';

export function Progress({
  received,
  total,
  done = false,
  doneLabel = '完成',
  doneTestId,
}: {
  received: number;
  total: number;
  done?: boolean;
  doneLabel?: string;
  doneTestId?: string;
}) {
  const pct =
    total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-end justify-between">
        <span className="font-display text-5xl font-bold tabular-nums">
          {done ? 100 : pct}
          <span className="text-2xl text-fg-faint">%</span>
        </span>
        <span className="mb-1 font-mono text-xs text-fg-muted">
          {formatBytes(received)} / {formatBytes(total)}
        </span>
      </div>

      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="relative h-full rounded-full bg-signal transition-[width] duration-300 ease-out"
          style={{ width: `${done ? 100 : pct}%` }}
        >
          {!done && pct > 0 && (
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent [animation:shimmer_1.4s_ease-in-out_infinite]" />
          )}
        </div>
      </div>

      <p className="sr-only" data-testid="progress-text">
        {pct}%
      </p>

      {done && (
        <div
          className="flex items-center gap-2 self-start rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-sm font-semibold text-success"
          data-testid={doneTestId}
        >
          <Check className="size-4" /> {doneLabel}
        </div>
      )}
    </div>
  );
}
