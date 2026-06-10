import { RoomShare } from '@/features/share/RoomShare';
import { useRoomsStore } from '@/state/conversation-store';
import { sessionManager } from '@/state/session-manager';

import { Composer } from './Composer';
import { Timeline } from './Timeline';

export function ConversationView() {
  const activeId = useRoomsStore(s => s.activeId);
  const session = useRoomsStore(s =>
    s.activeId ? s.sessions[s.activeId] : undefined
  );

  if (!activeId || !session) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 text-center text-sm text-fg-faint">
        点击左上角「+」新建会话，或粘贴邀请链接加入
      </main>
    );
  }

  if (session.connection === 'waiting') {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        {session.roomId ? (
          <div className="w-full max-w-sm">
            <RoomShare roomId={session.roomId} />
          </div>
        ) : (
          <span className="text-sm text-fg-faint">创建房间中…</span>
        )}
      </main>
    );
  }

  const connected = session.connection === 'connected';

  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden">
      <Timeline
        items={session.items}
        onAccept={id => sessionManager.acceptTransfer(activeId, id)}
        onReject={id => sessionManager.rejectTransfer(activeId, id)}
      />
      <Composer
        disabled={!connected}
        onSendText={text => sessionManager.sendText(activeId, text)}
        onSendFiles={files => sessionManager.sendFiles(activeId, files)}
      />
    </main>
  );
}
