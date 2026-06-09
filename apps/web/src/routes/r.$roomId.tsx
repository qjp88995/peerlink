import { createFileRoute } from '@tanstack/react-router';

import { ReceivePanel } from '@/features/receive/ReceivePanel';

export const Route = createFileRoute('/r/$roomId')({
  component: function ReceiveRoute() {
    const { roomId } = Route.useParams();
    return <ReceivePanel roomId={decodeURIComponent(roomId)} />;
  },
});
