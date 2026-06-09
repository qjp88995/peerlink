import { create } from 'zustand';

import type { FileEntry } from '@peerlink/protocol';

export type Phase =
  | 'idle'
  | 'waiting' // 已建房，等对端
  | 'connecting' // WebRTC 协商中
  | 'awaiting-accept' // 收到 manifest，等用户接受
  | 'transferring'
  | 'done'
  | 'error';

export type Role = 'sender' | 'receiver' | null;

interface Progress {
  received: number;
  total: number;
}

interface TransferState {
  phase: Phase;
  role: Role;
  roomId: string | null;
  manifest: FileEntry[] | null;
  progress: Progress;
  errorMessage: string | null;
  setRole(role: Role): void;
  setRoom(roomId: string): void;
  setPhase(phase: Phase): void;
  setManifest(files: FileEntry[]): void;
  updateProgress(received: number, total: number): void;
  fail(message: string): void;
  reset(): void;
}

const initial = {
  phase: 'idle' as Phase,
  role: null as Role,
  roomId: null as string | null,
  manifest: null as FileEntry[] | null,
  progress: { received: 0, total: 0 } as Progress,
  errorMessage: null as string | null,
};

export const useTransferStore = create<TransferState>(set => ({
  ...initial,
  setRole: role => set({ role }),
  setRoom: roomId => set({ roomId, phase: 'waiting' }),
  setPhase: phase => set({ phase }),
  setManifest: manifest => set({ manifest, phase: 'awaiting-accept' }),
  updateProgress: (received, total) => set({ progress: { received, total } }),
  fail: message => set({ phase: 'error', errorMessage: message }),
  reset: () => set({ ...initial }),
}));
