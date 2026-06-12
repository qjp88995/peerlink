import { Phone, PhoneMissed } from 'lucide-react';

import type { TimelineItem } from '@/state/conversation-store';

type CallItem = Extract<TimelineItem, { kind: 'call' }>;

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function label(item: CallItem): string {
  if (item.durationMs !== undefined) return `通话时长 ${fmt(item.durationMs)}`;
  switch (item.outcome) {
    case 'missed':
      return item.dir === 'in' ? '未接来电' : '对方未接听';
    case 'cancelled':
      return '已取消';
    case 'declined':
      return item.dir === 'in' ? '已拒绝' : '对方已拒绝';
    case 'busy':
      return '对方忙线中';
    case 'rejected':
      return '无法接通';
    case 'failed':
    default:
      return '通话中断';
  }
}

export function CallRecordBubble({ item }: { item: CallItem }) {
  const missed = item.durationMs === undefined && item.outcome !== 'cancelled';
  const Icon = missed ? PhoneMissed : Phone;
  return (
    <div className="my-1 flex justify-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2/60 px-3 py-1 text-xs text-fg-muted">
        <Icon className="size-3.5" />
        {label(item)}
      </span>
    </div>
  );
}
