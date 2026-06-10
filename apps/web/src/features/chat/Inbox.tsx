import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';

export function Inbox() {
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <ConversationList />
      <ConversationView />
    </div>
  );
}
