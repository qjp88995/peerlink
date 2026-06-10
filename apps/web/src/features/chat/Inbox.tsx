import { cn } from '@/lib/cn';
import { useRoomsStore } from '@/state/conversation-store';

import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';

export function Inbox() {
  const hasActive = useRoomsStore(s => s.activeId !== null);
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <ConversationList className={cn(hasActive && 'max-md:hidden')} />
      <ConversationView className={cn(!hasActive && 'max-md:hidden')} />
    </div>
  );
}
