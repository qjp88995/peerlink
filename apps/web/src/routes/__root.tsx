import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import { Toaster } from 'sonner';

import { BrandMark } from '@/features/common/BrandMark';

export const Route = createRootRoute({
  component: () => (
    <div className="flex min-h-dvh flex-col items-center px-5 py-8 sm:py-14">
      <main className="flex w-full max-w-md flex-col gap-7">
        <header className="animate-fade-up flex items-center gap-3">
          <BrandMark className="size-9" />
          <div className="flex flex-col leading-none">
            <span className="font-display text-xl font-extrabold tracking-tight">
              Peer<span className="text-signal">Link</span>
            </span>
            <span className="mt-1 font-mono text-[0.6875rem] tracking-wide text-fg-faint">
              端到端 · 浏览器直连
            </span>
          </div>
        </header>

        <Outlet />

        <footer className="animate-fade-up flex items-center justify-center gap-1.5 text-xs text-fg-faint [animation-delay:200ms]">
          <ShieldCheck className="size-3.5" />
          文件不经服务器中转，端到端 P2P 直传
        </footer>
      </main>

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
