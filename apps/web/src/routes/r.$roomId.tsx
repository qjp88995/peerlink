import { useEffect } from 'react';

import { createFileRoute } from '@tanstack/react-router';

import { Inbox } from '@/features/chat/Inbox';
import { sessionManager } from '@/state/session-manager';

export const Route = createFileRoute('/r/$roomId')({
  component: function JoinRoute() {
    const { roomId } = Route.useParams();
    const decoded = decodeURIComponent(roomId);
    useEffect(() => {
      sessionManager.join(decoded);
    }, [decoded]);
    return <Inbox />;
  },
});
