import { X } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * 屏幕共享时的会话侧栏。
 * - md+：in-flow 可收起栏（w-80 ↔ w-0），收起时舞台占满。
 * - 窄屏：从右侧滑入的覆盖抽屉 + 半透明遮罩。
 */
export function CallChatRail({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          'flex min-h-0 flex-col bg-surface transition-all duration-300',
          // 窄屏：覆盖抽屉
          'max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-[86%] max-md:max-w-sm max-md:border-l max-md:border-line max-md:shadow-2xl',
          open ? 'max-md:translate-x-0' : 'max-md:translate-x-full',
          // 桌面：可收起栏
          open
            ? 'md:w-80 md:border-l md:border-line'
            : 'md:w-0 md:overflow-hidden'
        )}
      >
        {/* 抽屉头（仅窄屏）：标题 + 收起 */}
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5 md:hidden">
          <span className="text-sm font-medium text-fg">会话</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="收起会话"
            className="grid size-8 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2/60 hover:text-fg"
          >
            <X className="size-4.5" />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
