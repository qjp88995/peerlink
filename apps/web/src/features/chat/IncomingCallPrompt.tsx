import { Phone, PhoneOff } from 'lucide-react';

export function IncomingCallPrompt({
  onAccept,
  onReject,
}: {
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-medium text-fg">
        <span className="size-2 animate-pulse rounded-full bg-signal" />
        语音通话来电…
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReject}
          aria-label="拒绝"
          className="flex size-10 items-center justify-center rounded-full bg-danger text-white"
        >
          <PhoneOff className="size-5" />
        </button>
        <button
          type="button"
          onClick={onAccept}
          aria-label="接听"
          className="flex size-10 items-center justify-center rounded-full bg-signal text-white"
        >
          <Phone className="size-5" />
        </button>
      </div>
    </div>
  );
}
