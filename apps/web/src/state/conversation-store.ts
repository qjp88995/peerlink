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

export interface Session {
  id: string;
  roomId: string | null;
  connection: Connection;
  items: TimelineItem[];
  unread: number;
}

interface RoomsState {
  sessions: Record<string, Session>;
  order: string[];
  activeId: string | null;
  addSession(id: string, roomId: string | null): void;
  removeSession(id: string): void;
  setActive(id: string | null): void;
  setRoom(id: string, roomId: string): void;
  setConnection(id: string, connection: Connection): void;
  appendText(id: string, item: TextItem): void;
  appendOutgoingFiles(
    id: string,
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ): void;
  appendIncomingFiles(
    id: string,
    transferId: string,
    files: FileEntry[],
    totalSize: number
  ): void;
  updateFileStatus(id: string, transferId: string, status: FileStatus): void;
  updateFileProgress(id: string, transferId: string, sent: number): void;
  reset(): void;
}

function patchSession(
  state: RoomsState,
  id: string,
  fn: (s: Session) => Session
): Partial<RoomsState> {
  const session = state.sessions[id];
  if (!session) return {};
  return { sessions: { ...state.sessions, [id]: fn(session) } };
}

function patchFileItem(
  items: TimelineItem[],
  transferId: string,
  patch: Partial<Extract<TimelineItem, { kind: 'file' }>>
): TimelineItem[] {
  return items.map(it =>
    it.kind === 'file' && it.id === transferId ? { ...it, ...patch } : it
  );
}

export const useRoomsStore = create<RoomsState>(set => ({
  sessions: {},
  order: [],
  activeId: null,

  addSession: (id, roomId) =>
    set(state => ({
      sessions: {
        ...state.sessions,
        [id]: { id, roomId, connection: 'connecting', items: [], unread: 0 },
      },
      order: state.order.includes(id) ? state.order : [...state.order, id],
      activeId: id,
    })),

  removeSession: id =>
    set(state => {
      const sessions = { ...state.sessions };
      delete sessions[id];
      return {
        sessions,
        order: state.order.filter(x => x !== id),
        activeId: state.activeId === id ? null : state.activeId,
      };
    }),

  setActive: id =>
    set(state =>
      id === null
        ? { activeId: null }
        : {
            ...patchSession(state, id, s => ({ ...s, unread: 0 })),
            activeId: id,
          }
    ),

  setRoom: (id, roomId) =>
    set(state => patchSession(state, id, s => ({ ...s, roomId }))),

  setConnection: (id, connection) =>
    set(state => patchSession(state, id, s => ({ ...s, connection }))),

  appendText: (id, item) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
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
        unread: id === state.activeId ? s.unread : s.unread + 1,
      }))
    ),

  appendOutgoingFiles: (id, transferId, files, totalSize) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'file',
            id: transferId,
            dir: 'out',
            files,
            totalSize,
            status: 'awaiting-accept',
            sent: 0,
          },
        ],
      }))
    ),

  appendIncomingFiles: (id, transferId, files, totalSize) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'file',
            id: transferId,
            dir: 'in',
            files,
            totalSize,
            status: 'awaiting-accept',
            sent: 0,
          },
        ],
        unread: id === state.activeId ? s.unread : s.unread + 1,
      }))
    ),

  updateFileStatus: (id, transferId, status) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: patchFileItem(s.items, transferId, { status }),
      }))
    ),

  updateFileProgress: (id, transferId, sent) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: patchFileItem(s.items, transferId, { sent }),
      }))
    ),

  reset: () => set({ sessions: {}, order: [], activeId: null }),
}));
