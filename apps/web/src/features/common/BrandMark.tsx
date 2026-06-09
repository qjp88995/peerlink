import type { ComponentProps } from 'react';

/** 点对点连线标记：两个端点 + 一条直连信号线。 */
export function BrandMark(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden {...props}>
      <path
        d="M9 16h14"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="0.1 5.2"
        className="text-fg-faint"
      />
      <circle
        cx="8"
        cy="16"
        r="4.5"
        className="fill-surface-2 stroke-fg-muted"
        strokeWidth="2"
      />
      <circle cx="24" cy="16" r="5.5" className="fill-signal" />
      <circle
        cx="24"
        cy="16"
        r="5.5"
        className="fill-none stroke-signal"
        strokeWidth="2"
        opacity="0.35"
      />
    </svg>
  );
}
