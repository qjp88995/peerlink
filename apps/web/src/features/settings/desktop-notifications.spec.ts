import { describe, expect, it } from 'vitest';

import { shouldNotify } from './desktop-notifications';

describe('shouldNotify', () => {
  const base = {
    prevUnread: 0,
    nextUnread: 1,
    focused: false,
    isActiveSession: false,
  };
  it('unread 增加且窗口失焦时通知', () => {
    expect(shouldNotify(base)).toBe(true);
  });
  it('聚焦且正停在该会话时不打扰', () => {
    expect(
      shouldNotify({ ...base, focused: true, isActiveSession: true })
    ).toBe(false);
  });
  it('虽聚焦但消息来自非活跃会话时仍通知', () => {
    expect(
      shouldNotify({ ...base, focused: true, isActiveSession: false })
    ).toBe(true);
  });
  it('unread 未增加时不通知', () => {
    expect(shouldNotify({ ...base, prevUnread: 2, nextUnread: 2 })).toBe(false);
  });
  it('unread 减少（已读）时不通知', () => {
    expect(shouldNotify({ ...base, prevUnread: 3, nextUnread: 1 })).toBe(false);
  });
});
