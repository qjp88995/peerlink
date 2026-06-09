import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';

import { ArrowRight, FileUp, Folder, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';

import { Progress } from '@/features/common/Progress';
import { Button, Card } from '@/features/common/ui';
import { RoomShare } from '@/features/share/RoomShare';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { startSendSession } from '@/lib/transfer-session';
import { useTransferStore } from '@/state/store';

export function SendPanel() {
  const store = useTransferStore();
  const sessionRef = useRef<{ cancel(): void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const totalBytes = picked.reduce((sum, f) => sum + f.size, 0);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    setPicked(Array.from(e.target.files ?? []));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) setPicked(files);
  }

  function removeAt(index: number) {
    setPicked(prev => prev.filter((_, i) => i !== index));
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

  if (store.phase === 'waiting' && store.roomId) {
    return (
      <Card>
        <RoomShare roomId={store.roomId} />
      </Card>
    );
  }

  if (store.phase === 'transferring' || store.phase === 'done') {
    return (
      <Card>
        <Progress
          received={store.progress.received}
          total={store.progress.total}
          done={store.phase === 'done'}
          doneLabel="发送完成"
          doneTestId="send-done"
        />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold tracking-tight">
          发送文件
        </h2>
        <p className="text-sm text-fg-muted">
          选择文件后生成口令与二维码，让对方扫码即可直连接收。
        </p>
      </div>

      <div
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'group flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors',
          dragging
            ? 'border-signal bg-signal/5'
            : 'border-line-bright bg-surface-2/40 hover:border-fg-faint'
        )}
      >
        <span
          className={cn(
            'flex size-14 items-center justify-center rounded-2xl border border-line-bright bg-surface text-fg-muted transition-colors',
            dragging && 'border-signal text-signal'
          )}
        >
          <UploadCloud className="size-7" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-fg">
            拖拽文件到这里，或点击选择
          </span>
          <span className="text-xs text-fg-faint">
            支持多文件 · 端到端加密直传
          </span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onPick}
        data-testid="file-input"
        className="hidden"
      />
      <input
        ref={el => {
          folderInputRef.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        onChange={onPick}
        data-testid="folder-input"
        className="hidden"
      />

      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="size-4" /> 选择文件
        </Button>
        <Button
          variant="ghost"
          className="flex-1"
          onClick={() => folderInputRef.current?.click()}
        >
          <Folder className="size-4" /> 选择文件夹
        </Button>
      </div>

      {picked.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1 text-xs text-fg-faint">
            <span>{picked.length} 个文件</span>
            <span className="font-mono">{formatBytes(totalBytes)}</span>
          </div>
          <ul className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
            {picked.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {f.webkitRelativePath || f.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-fg-faint">
                  {formatBytes(f.size)}
                </span>
                <button
                  onClick={() => removeAt(i)}
                  className="shrink-0 text-fg-faint transition-colors hover:text-danger"
                  aria-label="移除"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        disabled={!picked.length}
        onClick={start}
        data-testid="start-send"
        className="w-full"
      >
        生成分享口令 <ArrowRight className="size-4" />
      </Button>
    </Card>
  );
}
