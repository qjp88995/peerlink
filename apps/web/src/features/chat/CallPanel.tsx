import { useEffect, useRef, useState } from 'react';

import { Mic, MicOff, MonitorUp, MonitorX, PhoneOff } from 'lucide-react';

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
  screenStream,
  onHangup,
  onToggleMute,
  onToggleScreen,
}: {
  call: CallUiState;
  screenStream: MediaStream | null;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleScreen: () => void;
}) {
  const active = call.state === 'active';
  const elapsed = useElapsed(active);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.srcObject = screenStream;
  }, [screenStream]);

  if (call.state === 'idle' || call.state === 'ringing') return null;

  const sharing = call.screen === 'local';
  const peerSharing = call.screen === 'remote';

  return (
    <div className="flex flex-col border-b border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
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
            onClick={onToggleScreen}
            disabled={!active || peerSharing}
            aria-label={
              peerSharing ? '对方正在共享' : sharing ? '停止共享' : '共享屏幕'
            }
            title={peerSharing ? '对方正在共享' : undefined}
            className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-fg-muted disabled:opacity-50"
          >
            {sharing ? (
              <MonitorX className="size-4.5" />
            ) : (
              <MonitorUp className="size-4.5" />
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

      {call.screen !== 'none' && (
        // 视频 + 可叠加层容器：后续涂鸦的 <canvas> 直接叠在 <video> 之上，像素对齐。
        <div className="relative aspect-video w-full bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={sharing}
            className="absolute inset-0 size-full object-contain"
          />
          {/* 预留：标记/涂鸦 canvas 层将来挂这里 */}
        </div>
      )}
    </div>
  );
}
