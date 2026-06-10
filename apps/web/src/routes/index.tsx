import { createFileRoute } from '@tanstack/react-router';

import { ChatRoom } from '@/features/chat/ChatRoom';

export const Route = createFileRoute('/')({
  component: () => <ChatRoom mode="create" />,
});
