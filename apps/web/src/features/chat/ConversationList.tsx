import { useState } from 'react';

import { Plus, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useRoomsStore } from '@/state/conversation-store';
import { sessionManager } from '@/state/session-manager';

import {
  lastPreview,
  sessionName,
  type StatusTone,
  statusTone,
} from './conversation-list.helpers';

const TONE_DOT: Record<StatusTone, string> = {
  live: 'bg-success',
  pending: 'bg-signal',
  dead: 'bg-fg-faint',
};

function parseRoomId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes('/r/')) {
    const tail = trimmed.split('/r/')[1] ?? '';
    const code = tail.split(/[/?#]/)[0];
    return code ? decodeURIComponent(code) : null;
  }
  return trimmed;
}

export function ConversationList() {
  const sessions = useRoomsStore(s => s.sessions);
  const order = useRoomsStore(s => s.order);
  const activeId = useRoomsStore(s => s.activeId);
  const [link, setLink] = useState('');

  function joinFromLink() {
    const roomId = parseRoomId(link);
    if (!roomId) return;
    sessionManager.join(roomId);
    setLink('');
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-display text-lg font-extrabold tracking-tight">
          Peer<span className="text-signal">Link</span>
        </span>
        <button
          onClick={() => sessionManager.create()}
          aria-label="新建会话"
          className="flex size-8 items-center justify-center rounded-lg border border-line text-fg-muted transition-colors hover:border-fg-faint hover:text-fg"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <input
          value={link}
          onChange={e => setLink(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && joinFromLink()}
          placeholder="粘贴邀请链接或口令"
          className="w-full rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-fg-faint"
        />
      </div>

      <ul className="flex-1 overflow-y-auto">
        {order.map(id => {
          const session = sessions[id];
          if (!session) return null;
          const tone = statusTone(session.connection);
          const active = id === activeId;
          return (
            <li key={id}>
              <button
                onClick={() => useRoomsStore.getState().setActive(id)}
                className={cn(
                  'group flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-2/60',
                  active && 'bg-surface-2',
                  tone === 'dead' && 'opacity-50'
                )}
              >
                <span
                  className={cn(
                    'size-2.5 shrink-0 rounded-full',
                    TONE_DOT[tone]
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">
                    {sessionName(session)}
                  </span>
                  <span className="block truncate text-xs text-fg-faint">
                    {lastPreview(session)}
                  </span>
                </span>
                {session.unread > 0 && !active && (
                  <span className="shrink-0 rounded-full bg-signal px-1.5 text-xs font-medium text-surface">
                    {session.unread}
                  </span>
                )}
                <span
                  role="button"
                  aria-label="移除会话"
                  onClick={e => {
                    e.stopPropagation();
                    sessionManager.remove(id);
                  }}
                  className="hidden size-5 shrink-0 items-center justify-center rounded text-fg-faint hover:text-danger group-hover:flex"
                >
                  <X className="size-3.5" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
