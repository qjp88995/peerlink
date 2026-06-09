import { cn } from '@/lib/cn';

export function Progress({
  received,
  total,
}: {
  received: number;
  total: number;
}) {
  const pct =
    total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <div className="w-full">
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={cn('h-full rounded-full bg-blue-500 transition-all')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-gray-600" data-testid="progress-text">
        {pct}%
      </p>
    </div>
  );
}
