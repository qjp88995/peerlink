import { useEffect, useRef } from 'react';

import { toast } from 'sonner';

import { Progress } from '@/features/common/Progress';
import { startReceiveSession } from '@/lib/transfer-session';
import { useTransferStore } from '@/state/store';

export function ReceivePanel({ roomId }: { roomId: string }) {
  const store = useTransferStore();
  const sessionRef = useRef<ReturnType<typeof startReceiveSession> | null>(
    null
  );

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

  return (
    <div className="flex flex-col gap-4">
      {store.phase === 'awaiting-accept' && store.manifest && (
        <>
          <ul className="text-sm" data-testid="manifest">
            {store.manifest.map(f => (
              <li key={f.fileId}>
                {f.relativePath} · {f.size} B
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              className="rounded bg-green-600 px-4 py-2 text-white"
              onClick={() => sessionRef.current?.accept()}
              data-testid="accept"
            >
              接受
            </button>
            <button
              className="rounded bg-gray-300 px-4 py-2"
              onClick={() => sessionRef.current?.reject()}
              data-testid="reject"
            >
              拒绝
            </button>
          </div>
        </>
      )}
      {(store.phase === 'transferring' || store.phase === 'done') && (
        <>
          <Progress
            received={store.progress.received}
            total={store.progress.total}
          />
          {store.phase === 'done' && (
            <p data-testid="receive-done" className="text-green-600">
              接收完成
            </p>
          )}
        </>
      )}
    </div>
  );
}
