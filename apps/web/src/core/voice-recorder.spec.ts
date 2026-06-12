import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isVoiceSupported,
  pickMimeType,
  VoiceRecorder,
} from './voice-recorder';

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}
class FakeMediaRecorder {
  static supported = new Set(['audio/webm;codecs=opus']);
  static isTypeSupported(t: string) {
    return FakeMediaRecorder.supported.has(t);
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  constructor(_s: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? '';
  }
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    this.onstop?.();
  }
}

function install() {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => new FakeStream() },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('voice-recorder', () => {
  it('pickMimeType prefers opus webm', () => {
    install();
    expect(pickMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('isVoiceSupported reflects API availability', () => {
    install();
    expect(isVoiceSupported()).toBe(true);
  });

  it('records then stops, returning a blob and releasing tracks', async () => {
    install();
    const stream = new FakeStream();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: async () => stream },
    });
    const rec = new VoiceRecorder();
    await rec.start();
    const result = await rec.stop();
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.mimeType).toContain('audio/webm');
    expect(stream.getTracks()[0].stopped).toBe(true);
  });
});
