import { useEffect, useRef } from 'react';

import {
  decideWriter,
  detectCapabilities,
  manifestHasDirectory,
} from '@/core/storage/writer';
import type { TimelineItem } from '@/state/conversation-store';

import { FileBubble } from './FileBubble';
import { TextBubble } from './TextBubble';
import { VoiceBubble } from './VoiceBubble';

function unsupportedReason(item: Extract<TimelineItem, { kind: 'file' }>) {
  if (item.dir !== 'in') return undefined;
  const decision = decideWriter(detectCapabilities(), {
    fileCount: item.files.length,
    hasDirectory: manifestHasDirectory(item.files),
  });
  return decision.kind === 'unsupported' ? decision.reason : undefined;
}

export function Timeline({
  items,
  onAccept,
  onReject,
}: {
  items: TimelineItem[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
      {items.map(item =>
        item.kind === 'text' ? (
          <TextBubble key={item.id} dir={item.dir} text={item.text} />
        ) : item.kind === 'voice' ? (
          <VoiceBubble key={item.id} item={item} />
        ) : (
          <FileBubble
            key={item.id}
            item={item}
            unsupportedReason={unsupportedReason(item)}
            onAccept={() => onAccept(item.id)}
            onReject={() => onReject(item.id)}
          />
        )
      )}
      <div ref={bottomRef} />
    </div>
  );
}
