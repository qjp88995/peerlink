import { getBridge } from '@/lib/desktop-bridge';
import type { Session } from '@/state/conversation-store';
import { useRoomsStore } from '@/state/conversation-store';

export function shouldNotify(args: {
  prevUnread: number;
  nextUnread: number;
  focused: boolean;
  isActiveSession: boolean;
}): boolean {
  // 未读增加，且不是「窗口聚焦且正停在该会话」
  return (
    args.nextUnread > args.prevUnread && !(args.focused && args.isActiveSession)
  );
}

type Sessions = Record<string, Session>;

function totalUnread(sessions: Sessions): number {
  return Object.values(sessions).reduce((sum, s) => sum + s.unread, 0);
}

/** 找出 unread 刚增加的那条会话（用于通知点击跳转 + 判断是否活跃）。 */
function bumpedSessionId(prev: Sessions, next: Sessions): string | undefined {
  return Object.keys(next).find(
    id => (next[id]?.unread ?? 0) > (prev[id]?.unread ?? 0)
  );
}

/** 找出刚进入「来电」的会话：state==='ringing' && dir==='in'。 */
function incomingCallSessionId(
  prev: Sessions,
  next: Sessions
): string | undefined {
  const ringingIn = (s?: Session) =>
    s?.call.state === 'ringing' && s.call.dir === 'in';
  return Object.keys(next).find(
    id => ringingIn(next[id]) && !ringingIn(prev[id])
  );
}

let beep: (() => void) | undefined;
function playBeep(): void {
  if (!beep) {
    const AudioCtx = window.AudioContext;
    beep = () => {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    };
  }
  beep();
}

/** 在桌面端启动时调用一次：订阅 store，按需弹原生通知。 */
export function installDesktopNotifications(): void {
  const bridge = getBridge();
  if (!bridge) return;

  // 通知点击 → 切到对应会话
  bridge.onActivateSession(id => useRoomsStore.getState().setActive(id));

  let prev = useRoomsStore.getState().sessions;
  useRoomsStore.subscribe(state => {
    const next = state.sessions;
    const focused = document.hasFocus();

    // ① 来消息
    const msgId = bumpedSessionId(prev, next);
    if (
      msgId &&
      shouldNotify({
        prevUnread: totalUnread(prev),
        nextUnread: totalUnread(next),
        focused,
        isActiveSession: msgId === state.activeId,
      })
    ) {
      bridge.notify({
        title: 'PeerLink',
        body: '收到新消息',
        kind: 'message',
        sessionId: msgId,
      });
      playBeep();
    }

    // ② 来电（窗口看不见时才弹；可见时 CallPanel 已经在闪了）
    const callId = incomingCallSessionId(prev, next);
    if (callId && !focused) {
      bridge.notify({
        title: 'PeerLink',
        body: '来电…',
        kind: 'call',
        sessionId: callId,
      });
    }

    prev = next;
  });
}
