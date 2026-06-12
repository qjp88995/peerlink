import { useEffect, useState } from 'react';

import { Mic, MicOff, PhoneOff } from 'lucide-react';

import type { CallUiState } from '@/state/conversation-store';

const TEXT: Partial<Record<CallUiState['state'], string>> = {
  dialing: '正在呼叫…',
  connecting: '接通中…',
  reconnecting: '重连中…',
};

function useElapsed(active: boolean): string {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const t = setInterval(
      () => setS(Math.floor((Date.now() - start) / 1000)),
      1000
    );
    return () => clearInterval(t);
  }, [active]);
  const shown = active ? s : 0;
  return `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
}

export function CallPanel({
  call,
  onHangup,
  onToggleMute,
}: {
  call: CallUiState;
  onHangup: () => void;
  onToggleMute: () => void;
}) {
  const active = call.state === 'active';
  const elapsed = useElapsed(active);
  if (call.state === 'idle' || call.state === 'ringing') return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
      <span className="text-sm text-fg-muted">
        {active ? elapsed : TEXT[call.state]}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onToggleMute}
          disabled={!active}
          aria-label={call.muted ? '取消静音' : '静音'}
          className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-fg-muted disabled:opacity-50"
        >
          {call.muted ? (
            <MicOff className="size-4.5" />
          ) : (
            <Mic className="size-4.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onHangup}
          aria-label="挂断"
          className="flex size-9 items-center justify-center rounded-full bg-danger text-white"
        >
          <PhoneOff className="size-4.5" />
        </button>
      </div>
    </div>
  );
}
