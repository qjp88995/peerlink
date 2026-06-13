import { useEffect, useRef, useState } from 'react';

import {
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import type { CallUiState } from '@/state/conversation-store';

import { sessionGlyph } from './conversation-list.helpers';

const TEXT: Partial<Record<CallUiState['state'], string>> = {
  dialing: '正在呼叫…',
  connecting: '接通中…',
  reconnecting: '重连中…',
};

// 声波各柱的初相位（负 delay 让动画一上来就错峰，呈现起伏而非整齐划一）。
const WAVE_DELAYS = [
  -900, -200, -500, -700, -100, -400, -800, -300, -600, -150, -550, -250,
];

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

function CallAvatar({ glyph, pulse }: { glyph: string; pulse?: boolean }) {
  return (
    <div className="relative size-10 shrink-0">
      {pulse && (
        <>
          <span className="animate-ping-ring absolute inset-0 rounded-full border-2 border-signal" />
          <span className="animate-ping-ring absolute inset-0 rounded-full border-2 border-signal [animation-delay:0.6s]" />
        </>
      )}
      <span className="font-display absolute inset-0 z-1 grid place-items-center rounded-full bg-linear-to-br from-signal-bright to-signal-deep text-[15px] font-bold text-ink">
        {glyph}
      </span>
    </div>
  );
}

// 音量声波（装饰）：静音时转灰停摆。将来可接 AnalyserNode 显示真实电平。
function Waveform({ muted }: { muted: boolean }) {
  return (
    <div className="flex h-6.5 flex-1 items-center gap-0.75" aria-hidden>
      {WAVE_DELAYS.map((d, i) => (
        <span
          key={i}
          className={cn(
            'w-0.75 rounded-full',
            muted
              ? 'h-[18%] bg-fg-faint'
              : 'animate-equalize origin-center bg-signal'
          )}
          style={muted ? undefined : { animationDelay: `${d}ms` }}
        />
      ))}
    </div>
  );
}

function CtrlButton({
  onClick,
  disabled,
  label,
  title,
  active,
  danger,
  dock,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  title?: string;
  active?: boolean;
  danger?: boolean;
  dock?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className={cn(
        'grid place-items-center rounded-full border transition-all active:scale-90 disabled:opacity-40 disabled:active:scale-100',
        dock
          ? 'size-11 border-white/10 bg-white/5 text-fg backdrop-blur hover:enabled:bg-white/10'
          : 'size-10 border-line-bright bg-surface-2 text-fg-muted hover:enabled:-translate-y-px hover:enabled:text-fg',
        active && 'border-signal/40 bg-signal/20 text-signal-bright',
        danger &&
          'border-transparent bg-danger text-white hover:enabled:brightness-110'
      )}
    >
      {children}
    </button>
  );
}

export function CallPanel({
  call,
  roomId,
  screenStream,
  onHangup,
  onToggleMute,
  onToggleScreen,
  onToggleChat,
}: {
  call: CallUiState;
  roomId: string | null;
  screenStream: MediaStream | null;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleScreen: () => void;
  /** 共享时舞台右上角的会话侧栏开关；不传则不渲染。 */
  onToggleChat?: () => void;
}) {
  const active = call.state === 'active';
  const elapsed = useElapsed(active);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = screenStream;
    // 显式 play：挂载后才赋 srcObject 时 autoPlay 属性不总触发；
    // 忽略 AbortError（连续赋值打断）/ 自动播放拦截，有帧/手势后会自行恢复。
    if (screenStream) void el.play().catch(() => {});
  }, [screenStream]);

  if (call.state === 'idle' || call.state === 'ringing') return null;

  const glyph = sessionGlyph(roomId);
  const sharing = call.screen === 'local';
  const peerSharing = call.screen === 'remote';
  const anyScreen = call.screen !== 'none';

  const muteBtn = (dock?: boolean) => (
    <CtrlButton
      onClick={onToggleMute}
      disabled={!active}
      active={call.muted}
      dock={dock}
      label={call.muted ? '取消静音' : '静音'}
    >
      {call.muted ? (
        <MicOff className="size-4.5" />
      ) : (
        <Mic className="size-4.5" />
      )}
    </CtrlButton>
  );

  const screenBtn = (dock?: boolean) => (
    <CtrlButton
      onClick={onToggleScreen}
      disabled={!active || peerSharing}
      active={sharing}
      dock={dock}
      label={peerSharing ? '对方正在共享' : sharing ? '停止共享' : '共享屏幕'}
      title={peerSharing ? '对方正在共享' : undefined}
    >
      {sharing ? (
        <MonitorX className="size-4.5" />
      ) : (
        <MonitorUp className="size-4.5" />
      )}
    </CtrlButton>
  );

  const hangupBtn = (dock?: boolean) => (
    <CtrlButton onClick={onHangup} danger dock={dock} label="挂断">
      <PhoneOff className="size-4.5" />
    </CtrlButton>
  );

  return (
    <div
      className={cn(
        'flex flex-col border-b border-line bg-surface/80',
        // 共享时作为「舞台」接管剩余空间，让视频随视口收缩、不撑出屏幕
        anyScreen && 'min-h-0 min-w-0 flex-1'
      )}
    >
      {/* 控制台条 */}
      <div
        className={cn(
          'animate-slide-down relative flex shrink-0 items-center gap-3.5 overflow-hidden px-4',
          anyScreen ? 'py-2.5' : 'py-3'
        )}
      >
        {active && (
          <span className="pointer-events-none absolute inset-0 bg-linear-to-r from-signal/8 to-transparent to-[42%]" />
        )}
        <CallAvatar glyph={glyph} pulse={!active} />

        {active ? (
          <>
            <div className="flex shrink-0 flex-col gap-0.5">
              <span className="text-[11px] tracking-wider text-fg-faint uppercase">
                会议中
              </span>
              <span className="font-mono text-[17px] font-bold tabular-nums text-fg">
                {elapsed}
              </span>
            </div>
            <Waveform muted={call.muted} />
            {/* 共享时控制移到视频浮动坞，条上不再重复 */}
            {!anyScreen && (
              <div className="flex shrink-0 gap-2.5">
                {muteBtn()}
                {screenBtn()}
                {hangupBtn()}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[11px] tracking-wider text-fg-faint uppercase">
                会议
              </span>
              <span className="flex items-center gap-2 text-sm text-fg-muted">
                <Loader2 className="size-3 animate-spin text-signal" />
                {TEXT[call.state]}
              </span>
            </div>
            <div className="shrink-0">{hangupBtn()}</div>
          </>
        )}
      </div>

      {anyScreen && (
        // 视频 + 可叠加层容器：填充剩余高度，object-contain 完整显示（letterbox）。
        // 后续涂鸦的 <canvas> 直接叠在 <video> 之上，像素对齐。
        <div className="relative min-h-0 w-full flex-1 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={sharing}
            className="absolute inset-0 size-full object-contain"
          />
          {/* 预留：标记/涂鸦 canvas 层将来挂这里 */}

          {/* 顶/底渐隐遮罩，让浮层文字在任意画面上都清晰 */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-linear-to-b from-black/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-black/60 to-transparent" />

          {/* presenter 标识 */}
          <div className="absolute top-3 left-3.5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-ink/55 px-3 py-1.5 text-xs font-semibold text-fg backdrop-blur">
            <span className="size-2 animate-blink rounded-full bg-signal ring-4 ring-signal/25" />
            {sharing ? '你正在共享' : '对方正在共享'}
          </div>

          {/* 会话侧栏开关 */}
          {onToggleChat && (
            <button
              type="button"
              onClick={onToggleChat}
              aria-label="会话"
              className="absolute top-3 right-3.5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-ink/55 px-3 py-1.5 text-xs font-semibold text-fg backdrop-blur transition-colors hover:bg-ink/75"
            >
              <MessageSquare className="size-4" />
              会话
            </button>
          )}

          {/* 浮动控制坞 */}
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-ink/60 p-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-lg">
            {muteBtn(true)}
            {screenBtn(true)}
            <span className="h-6.5 w-px bg-white/15" />
            {hangupBtn(true)}
          </div>
        </div>
      )}
    </div>
  );
}
