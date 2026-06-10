import { type ChangeEvent, type KeyboardEvent, useRef, useState } from 'react';

import { Folder, Paperclip, Send } from 'lucide-react';

import { Button } from '@/features/common/ui';

export function Composer({
  disabled,
  onSendText,
  onSendFiles,
}: {
  disabled: boolean;
  onSendText: (text: string) => void;
  onSendFiles: (files: File[]) => void;
}) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

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
      <Button disabled={disabled} onClick={submit} aria-label="发送">
        <Send className="size-4" />
      </Button>
    </div>
  );
}
