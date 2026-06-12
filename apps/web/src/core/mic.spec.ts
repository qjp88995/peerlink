import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireMic } from './mic';

const g = globalThis as unknown as { navigator: unknown };
const orig = g.navigator;
afterEach(() => {
  g.navigator = orig;
  vi.restoreAllMocks();
});

describe('acquireMic', () => {
  it('throws unsupported when getUserMedia missing', async () => {
    g.navigator = {} as Navigator;
    await expect(acquireMic()).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('returns stream on success', async () => {
    const stream = {} as MediaStream;
    g.navigator = {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    } as unknown as Navigator;
    await expect(acquireMic()).resolves.toBe(stream);
  });

  it('maps NotAllowedError to permission-denied', async () => {
    g.navigator = {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('x'), { name: 'NotAllowedError' })
          ),
      },
    } as unknown as Navigator;
    await expect(acquireMic()).rejects.toMatchObject({
      reason: 'permission-denied',
    });
  });

  it('maps NotFoundError to no-mic', async () => {
    g.navigator = {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('x'), { name: 'NotFoundError' })
          ),
      },
    } as unknown as Navigator;
    await expect(acquireMic()).rejects.toMatchObject({ reason: 'no-mic' });
  });
});
