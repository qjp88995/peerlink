import {
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  useRef,
  useState,
} from 'react';

import { Folder, Keyboard, Mic, Paperclip, Send, X } from 'lucide-react';

import { Button } from '@/features/common/ui';

import { useVoiceRecorder } from './use-voice-recorder';

export function Composer({
  disabled,
  onSendText,
  onSendFiles,
  onSendVoice,
}: {
  disabled: boolean;
  onSendText: (text: string) => void;
  onSendFiles: (files: File[]) => void;
  onSendVoice: (blob: Blob, mimeType: string, durationMs: number) => void;
}) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const { supported, recording, start, stop, cancel } =
    useVoiceRecorder(onSendVoice);
  const coarse =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(pointer: coarse)').matches;

  // 手机端：文字 / 语音互斥模式切换。桌面端不用模式，麦克风作为空输入时的发送位按钮。
  const [voiceMode, setVoiceMode] = useState(false);
  const coarseVoice = coarse && voiceMode;
  const showDesktopMic = !coarse && supported && text.trim().length === 0;

  const startYRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendText(trimmed);
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) onSendFiles(files);
    e.target.value = '';
  }

  function onHoldPointerDown(e: PointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startYRef.current = e.clientY;
    cancelArmedRef.current = false;
    setCancelArmed(false);
    void start();
  }

  function onHoldPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const armed = startYRef.current - e.clientY > 60;
    if (armed !== cancelArmedRef.current) {
      cancelArmedRef.current = armed;
      setCancelArmed(armed);
    }
  }

  function onHoldPointerUp() {
    if (cancelArmedRef.current) cancel();
    else void stop();
    cancelArmedRef.current = false;
    setCancelArmed(false);
  }

  // 桌面（细指针）：点击进入独立录音条，再点发送/取消。
  if (recording && !coarse) {
    return (
      <div className="flex items-center gap-3 border-t border-line bg-surface px-3 py-3">
        <button
          type="button"
          onClick={cancel}
          aria-label="取消录音"
          className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:text-fg"
        >
          <X className="size-5" />
        </button>
        <div className="flex flex-1 items-center gap-2 text-sm text-fg-muted">
          <span className="size-2 animate-pulse rounded-full bg-danger" />
          正在录音…
        </div>
        <Button onClick={() => void stop()} aria-label="发送语音">
          <Send className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 border-t border-line bg-surface px-3 py-3">
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

      {coarse && supported && (
        <Button
          variant="ghost"
          disabled={disabled}
          aria-label={voiceMode ? '切换到文字' : '切换到语音'}
          onClick={() => {
            if (recording) return;
            setVoiceMode(v => !v);
          }}
        >
          {voiceMode ? (
            <Keyboard className="size-4" />
          ) : (
            <Mic className="size-4" />
          )}
        </Button>
      )}

      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        aria-label="发送文件"
      >
        <Paperclip className="size-4" />
      </Button>
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => folderInputRef.current?.click()}
        aria-label="发送文件夹"
      >
        <Folder className="size-4" />
      </Button>

      {coarseVoice ? (
        <button
          type="button"
          disabled={disabled}
          aria-label="按住录音"
          className="flex h-10 min-h-10 flex-1 touch-none select-none items-center justify-center gap-2 rounded-xl border border-line bg-surface-2/60 text-sm text-fg-muted disabled:opacity-50"
          onPointerDown={onHoldPointerDown}
          onPointerMove={onHoldPointerMove}
          onPointerUp={onHoldPointerUp}
          onPointerCancel={onHoldPointerUp}
        >
          {recording ? (
            <>
              <span className="size-2 animate-pulse rounded-full bg-danger" />
              <span className={cancelArmed ? 'text-danger' : undefined}>
                {cancelArmed ? '松开取消' : '松开发送 · 上滑取消'}
              </span>
            </>
          ) : (
            '按住 说话'
          )}
        </button>
      ) : (
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          maxLength={8192}
          rows={1}
          placeholder={disabled ? '等待连接…' : '输入消息，Enter 发送'}
          data-testid="composer-input"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-fg-faint disabled:opacity-50"
        />
      )}

      {showDesktopMic && (
        <Button
          variant="ghost"
          disabled={disabled}
          aria-label="录音"
          onClick={() => void start()}
        >
          <Mic className="size-4" />
        </Button>
      )}

      {text.trim().length > 0 && !coarseVoice && (
        <Button disabled={disabled} onClick={submit} aria-label="发送">
          <Send className="size-4" />
        </Button>
      )}
    </div>
  );
}
