import { cn } from '@/lib/cn';

export function TextBubble({ dir, text }: { dir: 'out' | 'in'; text: string }) {
  return (
    <div
      className={cn('flex', dir === 'out' ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm',
          dir === 'out'
            ? 'bg-signal text-ink'
            : 'border border-line bg-surface-2/60 text-fg'
        )}
      >
        {text}
      </div>
    </div>
  );
}
