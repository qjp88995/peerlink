import { type ChangeEvent, useRef, useState } from 'react';

import { toast } from 'sonner';

import { Progress } from '@/features/common/Progress';
import { RoomShare } from '@/features/share/RoomShare';
import { startSendSession } from '@/lib/transfer-session';
import { useTransferStore } from '@/state/store';

export function SendPanel() {
  const store = useTransferStore();
  const sessionRef = useRef<{ cancel(): void } | null>(null);
  const [picked, setPicked] = useState<File[]>([]);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    setPicked(Array.from(e.target.files ?? []));
  }

  function start() {
    if (!picked.length) return;
    store.setRole('sender');
    sessionRef.current = startSendSession(picked, {
      onRoom: roomId => store.setRoom(roomId),
      onPhase: p => store.setPhase(p),
      onProgress: (r, t) => store.updateProgress(r, t),
      onError: m => {
        store.fail(m);
        toast.error(m);
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {store.phase === 'idle' && (
        <>
          <input
            type="file"
            multiple
            onChange={onPick}
            data-testid="file-input"
          />
          {/* 文件夹选择：webkitdirectory 需运行时设置 */}
          <input
            type="file"
            multiple
            ref={el => {
              el?.setAttribute('webkitdirectory', '');
            }}
            onChange={onPick}
            data-testid="folder-input"
          />
          <button
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            disabled={!picked.length}
            onClick={start}
            data-testid="start-send"
          >
            生成分享（{picked.length} 个文件）
          </button>
        </>
      )}
      {store.phase === 'waiting' && store.roomId && (
        <RoomShare roomId={store.roomId} />
      )}
      {(store.phase === 'transferring' || store.phase === 'done') && (
        <>
          <Progress
            received={store.progress.received}
            total={store.progress.total}
          />
          {store.phase === 'done' && (
            <p data-testid="send-done" className="text-green-600">
              传输完成
            </p>
          )}
        </>
      )}
    </div>
  );
}
