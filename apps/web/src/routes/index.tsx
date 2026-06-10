import { createFileRoute } from '@tanstack/react-router';

import { Inbox } from '@/features/chat/Inbox';

export const Route = createFileRoute('/')({
  component: Inbox,
});
