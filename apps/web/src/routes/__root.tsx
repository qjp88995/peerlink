import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';

export const Route = createRootRoute({
  component: () => (
    <div className="h-dvh">
      <Outlet />

      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-line-bright)',
            color: 'var(--color-fg)',
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
    </div>
  ),
});
