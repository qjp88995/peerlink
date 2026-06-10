import { beforeEach, describe, expect, it } from 'vitest';

import { useConversationStore } from './conversation-store';

const files = [{ fileId: 0, name: 'a', size: 4, relativePath: 'a' }];

describe('conversation store', () => {
  beforeEach(() => useConversationStore.getState().reset());

  it('appends text items in order', () => {
    const s = useConversationStore.getState();
    s.appendText({ id: 'm1', dir: 'out', text: 'hi', ts: 1 });
    s.appendText({ id: 'm2', dir: 'in', text: 'yo', ts: 2 });
    const items = useConversationStore.getState().items;
    expect(items.map(i => i.id)).toEqual(['m1', 'm2']);
  });

  it('tracks an outgoing file from awaiting-accept to done', () => {
    const s = useConversationStore.getState();
    s.appendOutgoingFiles('T1', files, 4);
    expect(get('T1').status).toBe('awaiting-accept');
    s.updateFileStatus('T1', 'transferring');
    s.updateFileProgress('T1', 4);
    s.updateFileStatus('T1', 'done');
    const item = get('T1');
    expect(item).toMatchObject({ status: 'done', sent: 4, dir: 'out' });
  });

  it('incoming files start awaiting-accept', () => {
    useConversationStore.getState().appendIncomingFiles('T2', files, 4);
    expect(get('T2')).toMatchObject({ status: 'awaiting-accept', dir: 'in' });
  });
});

function get(id: string) {
  const item = useConversationStore.getState().items.find(i => i.id === id);
  if (!item || item.kind !== 'file') throw new Error('no file item ' + id);
  return item;
}
