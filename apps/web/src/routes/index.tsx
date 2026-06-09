import { createFileRoute } from '@tanstack/react-router';

import { SendPanel } from '@/features/send/SendPanel';

export const Route = createFileRoute('/')({
  component: SendPanel,
});
