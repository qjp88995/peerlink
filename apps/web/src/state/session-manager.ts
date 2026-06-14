import { toast } from 'sonner';

import { SessionManager, type SessionStore } from '@/core/session-manager';

import { useRoomsStore } from './conversation-store';

const store: SessionStore = {
  addSession: (id, roomId) => useRoomsStore.getState().addSession(id, roomId),
  removeSession: id => useRoomsStore.getState().removeSession(id),
  setActive: id => useRoomsStore.getState().setActive(id),
  setRoom: (id, roomId) => useRoomsStore.getState().setRoom(id, roomId),
  setConnection: (id, c) => useRoomsStore.getState().setConnection(id, c),
  appendText: (id, item) => useRoomsStore.getState().appendText(id, item),
  appendIncomingFiles: (id, t, files, total) =>
    useRoomsStore.getState().appendIncomingFiles(id, t, files, total),
  appendOutgoingFiles: (id, t, files, total) =>
    useRoomsStore.getState().appendOutgoingFiles(id, t, files, total),
  updateFileStatus: (id, t, s) =>
    useRoomsStore.getState().updateFileStatus(id, t, s),
  updateFileProgress: (id, t, sent) =>
    useRoomsStore.getState().updateFileProgress(id, t, sent),
  appendOutgoingVoice: (id, msgId, durationMs, size) =>
    useRoomsStore.getState().appendOutgoingVoice(id, msgId, durationMs, size),
  appendIncomingVoice: (id, msgId, durationMs, size) =>
    useRoomsStore.getState().appendIncomingVoice(id, msgId, durationMs, size),
  setVoiceReady: (id, msgId, url) =>
    useRoomsStore.getState().setVoiceReady(id, msgId, url),
  setVoiceFailed: (id, msgId) =>
    useRoomsStore.getState().setVoiceFailed(id, msgId),
  setCallState: (id, state, dir) =>
    useRoomsStore.getState().setCallState(id, state, dir),
  setCallError: (id, error) => useRoomsStore.getState().setCallError(id, error),
  setCallMuted: (id, muted) => useRoomsStore.getState().setCallMuted(id, muted),
  setScreenState: (id, screen) =>
    useRoomsStore.getState().setScreenState(id, screen),
  bumpScreen: id => useRoomsStore.getState().bumpScreen(id),
  appendCallRecord: (id, record) =>
    useRoomsStore.getState().appendCallRecord(id, record),
};

export const sessionManager = new SessionManager({
  store,
  onConnectionChange: (_id, state) => {
    if (state === 'closed') toast.info('对方已离开');
    if (state === 'error') toast.error('连接出错');
  },
});

// 关页 / 切后台时释放所有 P2P 连接与媒体轨，避免麦克风/摄像头占用残留、
// 让对端尽快得知断开。仅在浏览器环境注册（SSR/测试无 window 时跳过）。
if (typeof window !== 'undefined') sessionManager.installUnloadGuard();
