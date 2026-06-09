import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'animate-fade-up rounded-3xl border border-line bg-surface/80 p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:p-7',
        className
      )}
      {...props}
    />
  );
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'ghost' | 'danger';
};

const variants = {
  primary:
    'bg-signal text-ink hover:bg-signal-bright shadow-[0_10px_30px_-12px_var(--color-signal)] disabled:bg-line disabled:text-fg-faint disabled:shadow-none',
  ghost:
    'border border-line-bright bg-surface-2 text-fg hover:border-fg-faint hover:bg-surface',
  danger:
    'border border-line-bright bg-transparent text-fg-muted hover:text-danger hover:border-danger',
} as const;

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
