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
};

export const sessionManager = new SessionManager({
  store,
  onConnectionChange: (_id, state) => {
    if (state === 'closed') toast.info('对方已离开');
    if (state === 'error') toast.error('连接出错');
  },
});
