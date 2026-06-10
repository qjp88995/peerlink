import { create } from 'zustand';

import type { FileEntry } from '@peerlink/protocol';

import type { Connection, TextItem } from '../core/conversation';

export type FileStatus =
  | 'awaiting-accept'
  | 'transferring'
  | 'done'
  | 'rejected'
  | 'failed'
  | 'canceled';

export type TimelineItem =
  | { kind: 'text'; id: string; dir: 'out' | 'in'; text: string; ts: number }
  | {
      kind: 'file';
      id: string;
      dir: 'out' | 'in';
      files: FileEntry[];
      totalSize: number;
      status: FileStatus;
      sent: number;
    };

interface ConvState {
  connection: Connection;
  roomId: string | null;
  items: TimelineItem[];
  setConnection(state: Connection): void;
  setRoom(roomId: string): void;
  appendText(item: TextItem): void;
  appendOutgoingFiles(id: string, files: FileEntry[], totalSize: number): void;
  appendIncomingFiles(id: string, files: FileEntry[], totalSize: number): void;
  updateFileStatus(id: string, status: FileStatus): void;
  updateFileProgress(id: string, sent: number): void;
  reset(): void;
}

const initial = {
  connection: 'idle' as Connection,
  roomId: null as string | null,
  items: [] as TimelineItem[],
};

function patchFile(
  items: TimelineItem[],
  id: string,
  patch: Partial<Extract<TimelineItem, { kind: 'file' }>>
): TimelineItem[] {
  return items.map(it =>
    it.kind === 'file' && it.id === id ? { ...it, ...patch } : it
  );
}

export const useConversationStore = create<ConvState>(set => ({
  ...initial,
  setConnection: connection => set({ connection }),
  setRoom: roomId => set({ roomId }),
  appendText: item =>
    set(s => ({
      items: [
        ...s.items,
        {
          kind: 'text',
          id: item.id,
          dir: item.dir,
          text: item.text,
          ts: item.ts,
        },
      ],
    })),
  appendOutgoingFiles: (id, files, totalSize) =>
    set(s => ({
      items: [
        ...s.items,
        {
          kind: 'file',
          id,
          dir: 'out',
          files,
          totalSize,
          status: 'awaiting-accept',
          sent: 0,
        },
      ],
    })),
  appendIncomingFiles: (id, files, totalSize) =>
    set(s => ({
      items: [
        ...s.items,
        {
          kind: 'file',
          id,
          dir: 'in',
          files,
          totalSize,
          status: 'awaiting-accept',
          sent: 0,
        },
      ],
    })),
  updateFileStatus: (id, status) =>
    set(s => ({ items: patchFile(s.items, id, { status }) })),
  updateFileProgress: (id, sent) =>
    set(s => ({ items: patchFile(s.items, id, { sent }) })),
  reset: () => set({ ...initial, items: [] }),
}));
