import { useRef, useState } from 'react';

import { AlertCircle, Loader2, Volume2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { TimelineItem } from '@/state/conversation-store';

import { formatDuration } from './voice-format';

type Voice = Extract<TimelineItem, { kind: 'voice' }>;

export function VoiceBubble({ item }: { item: Voice }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const out = item.dir === 'out';
  const ready = item.status === 'ready' && !!item.url;
  const failed = item.status === 'failed';

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <button
        type="button"
        onClick={ready ? toggle : undefined}
        disabled={!ready}
        aria-label={failed ? '语音失败' : playing ? '暂停' : '播放语音'}
        className={cn(
          'flex min-w-24 items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm',
          out
            ? 'flex-row-reverse bg-signal text-ink'
            : 'border border-line bg-surface-2/60 text-fg',
          ready && 'cursor-pointer'
        )}
      >
        {failed ? (
          <span className="flex items-center gap-1.5 text-fg-muted">
            <AlertCircle className="size-4" /> 语音失败
          </span>
        ) : !ready ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <Volume2
              className={cn('size-4 shrink-0', playing && 'animate-pulse')}
            />
            <span className="tabular-nums">
              {formatDuration(item.durationMs)}
            </span>
          </>
        )}
      </button>
      {ready && (
        <audio
          ref={audioRef}
          src={item.url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  );
}
