import { useCallback, useRef, useState } from 'react';

import { toast } from 'sonner';

import { isVoiceSupported, VoiceRecorder } from '@/core/voice-recorder';

export function useVoiceRecorder(
  onComplete: (blob: Blob, mimeType: string, durationMs: number) => void
) {
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    const rec = new VoiceRecorder();
    recorderRef.current = rec;
    try {
      await rec.start();
      setRecording(true);
    } catch {
      recorderRef.current = null;
      setRecording(false);
      toast.error('无法访问麦克风，请检查权限');
    }
  }, []);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecording(false);
    try {
      const result = await rec.stop();
      if (result.blob.size > 0) {
        onComplete(result.blob, result.mimeType, result.durationMs);
      }
    } catch {
      /* 录音异常：丢弃 */
    }
  }, [onComplete]);

  const cancel = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    rec?.cancel();
  }, []);

  return { supported: isVoiceSupported(), recording, start, stop, cancel };
}
