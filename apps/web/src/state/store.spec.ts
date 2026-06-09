import { describe, expect, it } from 'vitest';

import { useTransferStore } from './store';

describe('useTransferStore', () => {
  it('starts idle', () => {
    expect(useTransferStore.getState().phase).toBe('idle');
  });

  it('setRoom moves to waiting and records the roomId', () => {
    useTransferStore.getState().reset();
    useTransferStore.getState().setRoom('8423-河马');
    const s = useTransferStore.getState();
    expect(s.phase).toBe('waiting');
    expect(s.roomId).toBe('8423-河马');
  });

  it('updateProgress clamps and stores received/total', () => {
    useTransferStore.getState().reset();
    useTransferStore.getState().updateProgress(50, 100);
    expect(useTransferStore.getState().progress).toEqual({
      received: 50,
      total: 100,
    });
  });
});
