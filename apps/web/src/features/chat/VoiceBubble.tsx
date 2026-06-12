import { useRef, useState } from 'react';

import { AlertCircle, Loader2, Pause, Play } from 'lucide-react';

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
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-2xl px-3.5 py-2 text-sm',
          out
            ? 'bg-signal text-ink'
            : 'border border-line bg-surface-2/60 text-fg'
        )}
      >
        {failed ? (
          <span className="flex items-center gap-1.5 text-fg-muted">
            <AlertCircle className="size-4" /> 语音失败
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={toggle}
              disabled={!ready}
              aria-label={playing ? '暂停' : '播放'}
              className="flex size-8 items-center justify-center rounded-full bg-black/10 disabled:opacity-50"
            >
              {!ready ? (
                <Loader2 className="size-4 animate-spin" />
              ) : playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </button>
            <span className="tabular-nums">
              {formatDuration(item.durationMs)}
            </span>
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
          </>
        )}
      </div>
    </div>
  );
}
