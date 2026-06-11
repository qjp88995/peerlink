import type { Connection } from '@/core/conversation';
import type { Session } from '@/state/conversation-store';

export function sessionName(session: Session): string {
  return session.roomId ? `#${session.roomId}` : '新会话';
}

export function statusHint(connection: Connection): string {
  switch (connection) {
    case 'waiting':
      return '等待对方加入…';
    case 'connecting':
      return '连接中…';
    case 'connected':
      return '已连接';
    case 'reconnecting':
      return '重连中…';
    case 'closed':
      return '已断开';
    case 'error':
      return '连接出错';
    default:
      return '';
  }
}

export function lastPreview(session: Session): string {
  const last = session.items[session.items.length - 1];
  if (!last) return statusHint(session.connection);
  if (last.kind === 'text') return last.text;
  const name = last.files[0]?.name ?? '文件';
  return last.files.length > 1
    ? `[文件] ${name} 等 ${last.files.length} 个`
    : `[文件] ${name}`;
}

export type StatusTone = 'live' | 'pending' | 'dead';

export function statusTone(connection: Connection): StatusTone {
  if (connection === 'connected') return 'live';
  if (connection === 'closed' || connection === 'error') return 'dead';
  return 'pending';
}
