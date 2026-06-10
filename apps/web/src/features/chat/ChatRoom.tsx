import { useEffect, useRef } from 'react';

import { toast } from 'sonner';

import {
  type ConversationHandle,
  startConversation,
} from '@/core/conversation';
import { Card } from '@/features/common/ui';
import { RoomShare } from '@/features/share/RoomShare';
import { useConversationStore } from '@/state/conversation-store';

import { Composer } from './Composer';
import { Timeline } from './Timeline';

type Mode = { mode: 'create' } | { mode: 'join'; roomId: string };

export function ChatRoom(init: Mode) {
  const store = useConversationStore();
  const handleRef = useRef<ConversationHandle | null>(null);

  useEffect(() => {
    const s = useConversationStore.getState();
    s.reset();
    handleRef.current = startConversation(init, {
      onRoom: roomId => s.setRoom(roomId),
      onConnection: state => {
        s.setConnection(state);
        if (state === 'closed') toast.info('对方已离开');
        if (state === 'error') toast.error('连接出错');
      },
      onText: item => s.appendText(item),
      onIncomingFiles: (id, files, total) =>
        s.appendIncomingFiles(id, files, total),
      onTransferStart: id => s.updateFileStatus(id, 'transferring'),
      onProgress: (id, sent) => s.updateFileProgress(id, sent),
      onTransferDone: id => s.updateFileStatus(id, 'done'),
      onTransferFailed: id => s.updateFileStatus(id, 'failed'),
      onTransferRejected: id => s.updateFileStatus(id, 'rejected'),
    });
    return () => handleRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = store.connection === 'connected';

  // 未连接且已建房：展示分享面板
  if (!connected && store.roomId && store.items.length === 0) {
    return (
      <Card>
        <RoomShare roomId={store.roomId} />
      </Card>
    );
  }

  return (
    <Card className="flex h-[70vh] flex-col overflow-hidden p-0">
      <Timeline
        items={store.items}
        onAccept={id => void handleRef.current?.acceptTransfer(id)}
        onReject={id => {
          handleRef.current?.rejectTransfer(id);
          store.updateFileStatus(id, 'rejected');
        }}
      />
      <Composer
        disabled={!connected}
        onSendText={text => {
          const item = handleRef.current?.sendText(text);
          if (item) store.appendText(item);
        }}
        onSendFiles={files => {
          const out = handleRef.current?.sendFiles(files);
          if (out)
            store.appendOutgoingFiles(
              out.transferId,
              out.entries,
              out.totalSize
            );
        }}
      />
    </Card>
  );
}
