import { ChevronLeft } from 'lucide-react';

import { RoomShare } from '@/features/share/RoomShare';
import { cn } from '@/lib/cn';
import type { Session } from '@/state/conversation-store';
import { useRoomsStore } from '@/state/conversation-store';
import { sessionManager } from '@/state/session-manager';

import { Composer } from './Composer';
import { sessionName, statusHint } from './conversation-list.helpers';
import { Timeline } from './Timeline';

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
      <Timeline
        items={session.items}
        onAccept={id => sessionManager.acceptTransfer(activeId, id)}
        onReject={id => sessionManager.rejectTransfer(activeId, id)}
      />
      <Composer
        disabled={!connected}
        onSendText={text => sessionManager.sendText(activeId, text)}
        onSendFiles={files => sessionManager.sendFiles(activeId, files)}
        onSendVoice={(blob, mimeType, durationMs) =>
          void sessionManager.sendVoice(activeId, blob, mimeType, durationMs)
        }
      />
    </main>
  );
}
