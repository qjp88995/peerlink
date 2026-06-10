import { createFileRoute } from '@tanstack/react-router';

import { ChatRoom } from '@/features/chat/ChatRoom';

export const Route = createFileRoute('/r/$roomId')({
  component: function JoinRoute() {
    const { roomId } = Route.useParams();
    return <ChatRoom mode="join" roomId={decodeURIComponent(roomId)} />;
  },
});
