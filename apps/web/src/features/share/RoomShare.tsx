import { useEffect, useState } from 'react';

import { Check, Copy, Link2 } from 'lucide-react';
import QRCode from 'qrcode';

import { cn } from '@/lib/cn';

export function RoomShare({ roomId }: { roomId: string }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const link = `${location.origin}/r/${encodeURIComponent(roomId)}`;

  useEffect(() => {
    void QRCode.toDataURL(link, {
      margin: 1,
      color: { dark: '#100e0d', light: '#f6f1ea' },
    }).then(setQr);
  }, [link]);

  function copy(value: string, which: 'code' | 'link') {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1600);
    });
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-2 self-start">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full rounded-full bg-signal [animation:ping-ring_1.6s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <span className="relative inline-flex size-2.5 rounded-full bg-signal" />
        </span>
        <span className="text-sm font-medium text-fg-muted">等待对方接入…</span>
      </div>

      {qr && (
        <div className="rounded-2xl border border-line-bright bg-[#f6f1ea] p-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]">
          <img src={qr} alt="二维码" className="size-44 rounded-lg" />
        </div>
      )}

      <button
        onClick={() => copy(roomId, 'code')}
        className="group flex w-full flex-col items-center gap-1.5 rounded-2xl border border-line bg-surface-2/60 px-4 py-4 transition-colors hover:border-fg-faint"
      >
        <span className="text-xs uppercase tracking-[0.2em] text-fg-faint">
          分享口令
        </span>
        <span
          className="font-mono text-3xl font-bold tracking-[0.18em] text-fg"
          data-testid="room-code"
        >
          {roomId}
        </span>
        <span className="flex items-center gap-1 text-xs text-fg-faint group-hover:text-signal">
          {copied === 'code' ? (
            <>
              <Check className="size-3.5" /> 已复制
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> 点击复制口令
            </>
          )}
        </span>
      </button>

      <button
        onClick={() => copy(link, 'link')}
        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2/40 px-3.5 py-3 text-left transition-colors hover:border-fg-faint"
      >
        <Link2 className="size-4 shrink-0 text-fg-faint" />
        <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
          {link}
        </span>
        <span
          className={cn(
            'shrink-0 transition-colors',
            copied === 'link' ? 'text-success' : 'text-fg-faint'
          )}
        >
          {copied === 'link' ? (
            <Check className="size-4" />
          ) : (
            <Copy className="size-4" />
          )}
        </span>
      </button>

      <p className="text-center text-xs text-fg-faint">
        把二维码、口令或链接发给对方，连接后即开始直传
      </p>
    </div>
  );
}
