import { useEffect, useState } from 'react';

import { ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';

import { RoomShare } from '@/features/share/RoomShare';
import { cn } from '@/lib/cn';
import type { Session } from '@/state/conversation-store';
import { useRoomsStore } from '@/state/conversation-store';
import { sessionManager } from '@/state/session-manager';

import { CallChatRail } from './CallChatRail';
import { CallPanel } from './CallPanel';
import { Composer } from './Composer';
import { sessionName, statusHint } from './conversation-list.helpers';
import { IncomingCallPrompt } from './IncomingCallPrompt';
import { Timeline } from './Timeline';

const CALL_ERROR_TEXT: Record<string, string> = {
  unsupported: '对方设备不支持会议',
  'no-mic': '对方无可用麦克风',
  'permission-denied': '对方拒绝了麦克风权限',
  declined: '对方拒绝了邀请',
  busy: '对方正在会议中',
  // 本端发起屏幕共享失败（区别于上面的对方视角文案）
  'screen-denied': '屏幕共享权限被拒绝',
  'screen-unsupported': '此浏览器不支持屏幕共享',
};

function MobileHeader({ session }: { session: Session }) {
  return (
    <header className="flex items-center gap-2 border-b border-line px-2 py-2 md:hidden">
      <button
        onClick={() => useRoomsStore.getState().setActive(null)}
        aria-label="返回会话列表"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2/60 hover:text-fg"
      >
        <ChevronLeft className="size-5" />
      </button>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg">
          {sessionName(session)}
        </div>
        <div className="truncate text-xs text-fg-faint">
          {statusHint(session.connection)}
        </div>
      </div>
    </header>
  );
}

export function ConversationView({ className }: { className?: string }) {
  const activeId = useRoomsStore(s => s.activeId);
  const session = useRoomsStore(s =>
    s.activeId ? s.sessions[s.activeId] : undefined
  );
  const callError = session?.call.error;
  // 共享时会话侧栏开合：桌面默认展开，窄屏默认收起（抽屉）。
  const [chatOpen, setChatOpen] = useState(
    () => window.matchMedia('(min-width: 768px)').matches
  );

  useEffect(() => {
    if (!activeId || !callError) return;
    toast.error(CALL_ERROR_TEXT[callError] ?? '会议连接失败');
    useRoomsStore.getState().setCallError(activeId, undefined);
  }, [activeId, callError]);

  if (!activeId || !session) {
    return (
      <main
        className={cn(
          'flex flex-1 items-center justify-center px-6 text-center text-sm text-fg-faint',
          className
        )}
      >
        点击左上角「+」新建会话，或粘贴邀请链接加入
      </main>
    );
  }

  if (session.connection === 'waiting') {
    return (
      <main
        className={cn('flex h-full flex-1 flex-col overflow-hidden', className)}
      >
        <MobileHeader session={session} />
        <div className="flex flex-1 items-center justify-center p-6">
          {session.roomId ? (
            <div className="w-full max-w-sm">
              <RoomShare roomId={session.roomId} />
            </div>
          ) : (
            <span className="text-sm text-fg-faint">创建房间中…</span>
          )}
        </div>
      </main>
    );
  }

  const connected = session.connection === 'connected';
  // 屏幕共享 → 会议室布局：中=舞台，右=会话侧栏/抽屉
  const sharing = session.call.screen !== 'none';

  const callPanel = (
    <CallPanel
      call={session.call}
      roomId={session.roomId}
      screenStream={sessionManager.getScreenStream(activeId)}
      onHangup={() => sessionManager.hangupCall(activeId)}
      onToggleMute={() =>
        sessionManager.toggleMute(activeId, !session.call.muted)
      }
      onToggleScreen={() =>
        session.call.screen === 'local'
          ? sessionManager.stopScreenShare(activeId)
          : sessionManager.startScreenShare(activeId)
      }
      onToggleChat={sharing ? () => setChatOpen(o => !o) : undefined}
    />
  );

  const timeline = (
    <Timeline
      items={session.items}
      onAccept={id => sessionManager.acceptTransfer(activeId, id)}
      onReject={id => sessionManager.rejectTransfer(activeId, id)}
    />
  );

  const composer = (
    <Composer
      disabled={!connected}
      onSendText={text => sessionManager.sendText(activeId, text)}
      onSendFiles={files => sessionManager.sendFiles(activeId, files)}
      onSendVoice={(blob, mimeType, durationMs) =>
        void sessionManager.sendVoice(activeId, blob, mimeType, durationMs)
      }
      onDial={() => sessionManager.dialCall(activeId)}
      callBusy={session.call.state !== 'idle'}
    />
  );

  return (
    <main
      className={cn('flex h-full flex-1 flex-col overflow-hidden', className)}
    >
      <MobileHeader session={session} />
      {session.connection === 'reconnecting' && (
        <div className="border-b border-line bg-signal/10 px-4 py-1.5 text-center text-xs text-fg-muted">
          网络波动，重连中…
        </div>
      )}
      {session.call.state === 'ringing' && session.call.dir === 'in' && (
        <IncomingCallPrompt
          roomId={session.roomId}
          onAccept={() => sessionManager.acceptCall(activeId)}
          onReject={() => sessionManager.rejectCall(activeId)}
        />
      )}
      {/*
        包裹层用 contents/flex 切换，让 CallPanel 始终是同一位置的第一个子节点，
        共享开关切换时不重挂载 —— 否则 CallPanel 内的会议计时会被重置。
      */}
      <div className={cn(sharing ? 'flex min-h-0 flex-1' : 'contents')}>
        {callPanel}
        {sharing ? (
          <CallChatRail open={chatOpen} onClose={() => setChatOpen(false)}>
            {timeline}
            {composer}
          </CallChatRail>
        ) : (
          <>
            {timeline}
            {composer}
          </>
        )}
      </div>
    </main>
  );
}
