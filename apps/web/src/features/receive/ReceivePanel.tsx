import { useEffect, useMemo, useRef } from 'react';

import { Check, FileDown, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  decideWriter,
  detectCapabilities,
  manifestHasDirectory,
} from '@/core/storage/writer';
import { Progress } from '@/features/common/Progress';
import { Button, Card } from '@/features/common/ui';
import { formatBytes } from '@/lib/format';
import { startReceiveSession } from '@/lib/transfer-session';
import { useTransferStore } from '@/state/store';

export function ReceivePanel({ roomId }: { roomId: string }) {
  const store = useTransferStore();
  const sessionRef = useRef<ReturnType<typeof startReceiveSession> | null>(
    null
  );

  const decision = useMemo(
    () =>
      store.manifest
        ? decideWriter(detectCapabilities(), {
            fileCount: store.manifest.length,
            hasDirectory: manifestHasDirectory(store.manifest),
          })
        : null,
    [store.manifest]
  );
  const unsupported = decision?.kind === 'unsupported';

  useEffect(() => {
    if (store.phase === 'awaiting-accept' && unsupported) {
      sessionRef.current?.reject();
    }
  }, [store.phase, unsupported]);

  useEffect(() => {
    store.setRole('receiver');
    sessionRef.current = startReceiveSession(roomId, {
      onManifest: files => store.setManifest(files),
      onPhase: p => store.setPhase(p),
      onProgress: (r, t) => store.updateProgress(r, t),
      onError: m => {
        store.fail(m);
        toast.error(m);
      },
    });
    return () => sessionRef.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (store.phase === 'transferring' || store.phase === 'done') {
    return (
      <Card>
        <Progress
          received={store.progress.received}
          total={store.progress.total}
          done={store.phase === 'done'}
          doneLabel="接收完成"
          doneTestId="receive-done"
        />
      </Card>
    );
  }

  if (store.phase === 'awaiting-accept' && store.manifest) {
    const totalBytes = store.manifest.reduce((s, f) => s + f.size, 0);
    return (
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            收到文件请求
          </h2>
          <p className="text-sm text-fg-muted">
            对方想发送以下文件，确认后开始直传。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1 text-xs text-fg-faint">
            <span>{store.manifest.length} 个文件</span>
            <span className="font-mono">{formatBytes(totalBytes)}</span>
          </div>
          <ul
            className="flex max-h-60 flex-col gap-1.5 overflow-y-auto"
            data-testid="manifest"
          >
            {store.manifest.map(f => (
              <li
                key={f.fileId}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2"
              >
                <FileDown className="size-4 shrink-0 text-fg-faint" />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {f.relativePath}
                </span>
                <span className="shrink-0 font-mono text-xs text-fg-faint">
                  {formatBytes(f.size)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {unsupported ? (
          <div
            role="alert"
            data-testid="unsupported"
            className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger"
          >
            {decision?.kind === 'unsupported' && decision.reason}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => sessionRef.current?.accept()}
              data-testid="accept"
            >
              <Check className="size-4" /> 接受并接收
            </Button>
            <Button
              variant="danger"
              onClick={() => sessionRef.current?.reject()}
              data-testid="reject"
            >
              <X className="size-4" /> 拒绝
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center gap-4 py-12 text-center">
      <Loader2 className="size-8 text-signal animate-spin-slow" />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-fg">正在连接发送方…</span>
        <span className="font-mono text-xs text-fg-faint">房间 {roomId}</span>
      </div>
    </Card>
  );
}
