import { describe, expect, it } from 'vitest';

import type { Session } from '@/state/conversation-store';

import {
  lastPreview,
  sessionName,
  statusHint,
  statusTone,
} from './conversation-list.helpers';

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'A',
    roomId: 'abc123',
    connection: 'connected',
    items: [],
    unread: 0,
    call: { state: 'idle', dir: null, muted: false, screen: 'none' },
    ...over,
  };
}

describe('conversation-list helpers', () => {
  it('names a session by its room code, falling back when absent', () => {
    expect(sessionName(session({ roomId: 'abc123' }))).toBe('#abc123');
    expect(sessionName(session({ roomId: null }))).toBe('新会话');
  });

  it('previews the last text message', () => {
    expect(
      lastPreview(
        session({
          items: [{ kind: 'text', id: 'm', dir: 'in', text: '你好', ts: 1 }],
        })
      )
    ).toBe('你好');
  });

  it('previews a file by name', () => {
    expect(
      lastPreview(
        session({
          items: [
            {
              kind: 'file',
              id: 'T',
              dir: 'in',
              files: [
                { fileId: 0, name: 'a.png', size: 1, relativePath: 'a.png' },
              ],
              totalSize: 1,
              status: 'awaiting-accept',
              sent: 0,
            },
          ],
        })
      )
    ).toBe('[文件] a.png');
  });

  it('previews a voice message', () => {
    expect(
      lastPreview(
        session({
          items: [
            {
              kind: 'voice',
              id: 'v1',
              dir: 'in',
              status: 'ready',
              durationMs: 1000,
              size: 100,
              ts: 0,
            },
          ],
        })
      )
    ).toBe('[语音]');
  });

  it('falls back to a status hint when there are no messages', () => {
    expect(lastPreview(session({ items: [], connection: 'waiting' }))).toBe(
      '等待对方加入…'
    );
  });

  it('maps connection to a status tone', () => {
    expect(statusTone('connected')).toBe('live');
    expect(statusTone('waiting')).toBe('pending');
    expect(statusTone('connecting')).toBe('pending');
    expect(statusTone('closed')).toBe('dead');
    expect(statusTone('error')).toBe('dead');
    expect(statusTone('reconnecting')).toBe('pending');
  });

  it('maps connection to a status hint', () => {
    expect(statusHint('reconnecting')).toBe('重连中…');
  });
});
