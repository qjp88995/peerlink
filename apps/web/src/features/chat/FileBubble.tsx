import { Check, FileDown, FileUp, X } from 'lucide-react';

import { Button } from '@/features/common/ui';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import type { TimelineItem } from '@/state/conversation-store';

type FileItem = Extract<TimelineItem, { kind: 'file' }>;

const STATUS_LABEL: Record<FileItem['status'], string> = {
  'awaiting-accept': '等待确认',
  transferring: '传输中',
  done: '已完成',
  rejected: '已拒绝',
  failed: '失败',
  canceled: '已取消',
};

const STATUS_TONE: Record<FileItem['status'], string> = {
  'awaiting-accept': 'text-fg-faint',
  transferring: 'text-signal',
  done: 'text-success',
  rejected: 'text-danger',
  failed: 'text-danger',
  canceled: 'text-fg-faint',
};

export function FileBubble({
  item,
  unsupportedReason,
  onAccept,
  onReject,
}: {
  item: FileItem;
  unsupportedReason?: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const Icon = item.dir === 'out' ? FileUp : FileDown;
  const canAct = item.dir === 'in' && item.status === 'awaiting-accept';
  const pct =
    item.totalSize > 0
      ? Math.min(100, Math.round((item.sent / item.totalSize) * 100))
      : 0;

  return (
    <div
      className={cn(
        'flex',
        item.dir === 'out' ? 'justify-end' : 'justify-start'
      )}
    >
      <div className="flex w-72 max-w-[85%] flex-col gap-2 rounded-2xl border border-line bg-surface-2/60 p-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-fg-faint" />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">
            {item.files.length === 1
              ? item.files[0].relativePath
              : `${item.files.length} 个文件`}
          </span>
          <span className="shrink-0 font-mono text-xs text-fg-faint">
            {formatBytes(item.totalSize)}
          </span>
        </div>

        {item.status === 'transferring' && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-signal transition-[width] duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span
              className="self-end font-mono text-xs text-fg-faint tabular-nums"
              data-testid="progress-text"
            >
              {pct}%
            </span>
          </div>
        )}

        {canAct && unsupportedReason ? (
          <div
            role="alert"
            data-testid="unsupported"
            className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger"
          >
            {unsupportedReason}
          </div>
        ) : canAct ? (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onAccept} data-testid="accept">
              <Check className="size-4" /> 接收
            </Button>
            <Button variant="danger" onClick={onReject} data-testid="reject">
              <X className="size-4" /> 拒绝
            </Button>
          </div>
        ) : (
          <span className={cn('text-xs', STATUS_TONE[item.status])}>
            {STATUS_LABEL[item.status]}
          </span>
        )}
      </div>
    </div>
  );
}
