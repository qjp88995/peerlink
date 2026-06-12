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

export type VoiceStatus = 'sending' | 'receiving' | 'ready' | 'failed';

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
    }
  | {
      kind: 'voice';
      id: string;
      dir: 'out' | 'in';
      status: VoiceStatus;
      durationMs: number;
      size: number;
      url?: string;
      ts: number;
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
  appendOutgoingVoice(
    id: string,
    msgId: string,
    durationMs: number,
    size: number
  ): void;
  appendIncomingVoice(
    id: string,
    msgId: string,
    durationMs: number,
    size: number
  ): void;
  setVoiceReady(id: string, msgId: string, url: string): void;
  setVoiceFailed(id: string, msgId: string): void;
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

function patchVoiceItem(
  items: TimelineItem[],
  msgId: string,
  patch: Partial<Extract<TimelineItem, { kind: 'voice' }>>
): TimelineItem[] {
  return items.map(it =>
    it.kind === 'voice' && it.id === msgId ? { ...it, ...patch } : it
  );
}

function revokeVoiceUrls(session: Session): void {
  for (const it of session.items) {
    if (it.kind === 'voice' && it.url) {
      try {
        URL.revokeObjectURL(it.url);
      } catch {
        /* environment without revokeObjectURL: ignore */
      }
    }
  }
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
      const removed = state.sessions[id];
      if (removed) revokeVoiceUrls(removed);
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
        unread:
          item.dir === 'out' || id === state.activeId ? s.unread : s.unread + 1,
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

  appendOutgoingVoice: (id, msgId, durationMs, size) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'voice',
            id: msgId,
            dir: 'out',
            status: 'sending',
            durationMs,
            size,
            ts: Date.now(),
          },
        ],
      }))
    ),

  appendIncomingVoice: (id, msgId, durationMs, size) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'voice',
            id: msgId,
            dir: 'in',
            status: 'receiving',
            durationMs,
            size,
            ts: Date.now(),
          },
        ],
        unread: id === state.activeId ? s.unread : s.unread + 1,
      }))
    ),

  setVoiceReady: (id, msgId, url) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: patchVoiceItem(s.items, msgId, { status: 'ready', url }),
      }))
    ),

  setVoiceFailed: (id, msgId) =>
    set(state =>
      patchSession(state, id, s => ({
        ...s,
        items: patchVoiceItem(s.items, msgId, { status: 'failed' }),
      }))
    ),

  reset: () =>
    set(state => {
      for (const session of Object.values(state.sessions))
        revokeVoiceUrls(session);
      return { sessions: {}, order: [], activeId: null };
    }),
}));
