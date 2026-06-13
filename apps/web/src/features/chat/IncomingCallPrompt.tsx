import { Check, X } from 'lucide-react';

import { sessionGlyph } from './conversation-list.helpers';

export function IncomingCallPrompt({
  roomId,
  onAccept,
  onReject,
}: {
  roomId: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="animate-slide-down relative flex items-center gap-3.5 overflow-hidden border-b border-line bg-surface/80 px-4 py-3.5">
      {/* signal 渐变左缘光条 */}
      <span className="absolute inset-y-0 left-0 w-0.75 bg-linear-to-b from-signal to-signal-deep shadow-[0_0_18px_var(--color-signal)]" />

      {/* 振铃头像：同心脉冲环 + roomId 字形 */}
      <div className="relative size-11.5 shrink-0">
        <span className="animate-ping-ring absolute inset-0 rounded-full border-2 border-signal" />
        <span className="animate-ping-ring absolute inset-0 rounded-full border-2 border-signal [animation-delay:0.6s]" />
        <span className="font-display absolute inset-0 z-1 grid place-items-center rounded-full bg-linear-to-br from-signal-bright to-signal-deep text-lg font-bold text-ink">
          {sessionGlyph(roomId)}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-display text-[15px] font-bold text-fg">
          会议邀请
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
          <span className="size-1.5 animate-blink rounded-full bg-signal" />
          对方想和你开会议…
        </div>
      </div>

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onReject}
          aria-label="拒绝"
          className="grid size-11.5 place-items-center rounded-full bg-danger text-white shadow-[0_6px_20px_-8px_var(--color-danger)] transition-transform active:scale-90"
        >
          <X className="size-5" />
        </button>
        <button
          type="button"
          onClick={onAccept}
          aria-label="加入会议"
          className="animate-bob grid size-11.5 place-items-center rounded-full bg-success text-ink shadow-[0_6px_20px_-6px_var(--color-success)] transition-transform active:scale-90"
        >
          <Check className="size-5" />
        </button>
      </div>
    </div>
  );
}
