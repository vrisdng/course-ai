import { FileText, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { StoredVideoPlayer } from '@/features/video-playback/StoredVideoPlayer';

import { groupSegmentsIntoParagraphs } from './groupTranscriptSegments';
import { formatCitationLocator, formatTimestamp } from './time';
import { useTranscriptWindow } from './useTranscriptWindow';
import type { ActiveVideoSource } from './VideoSourceDialog';

export function VideoTranscript({ source }: { source: ActiveVideoSource }) {
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const [seekMs, setSeekMs] = useState<number | undefined>(undefined);
  const { segments, isLoading } = useTranscriptWindow(
    source.materialId,
    source.startMs,
    source.endMs,
  );

  useEffect(() => {
    if (!highlightRef.current || isLoading) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [segments, isLoading]);

  const paragraphs = groupSegmentsIntoParagraphs(segments);
  const citedEndMs = source.endMs ?? source.startMs;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <FileText className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{source.title}</p>
          <p className="text-xs text-muted-foreground">
            Cited segment: {formatCitationLocator({ startMs: source.startMs, endMs: source.endMs })}
          </p>
        </div>
      </div>

      {source.signedUrl || source.filePath ? (
        <div className="space-y-2">
          <StoredVideoPlayer
            filePath={source.filePath}
            initialUrl={source.signedUrl}
            startMs={source.startMs}
            seekMs={seekMs}
            showOpenLink
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading transcript...
        </div>
      ) : paragraphs.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          No transcript segments available.
        </div>
      ) : (
        <div className="space-y-2">
          {paragraphs.map((para) => {
            const highlighted =
              para.startMs <= citedEndMs + 500 && para.endMs >= source.startMs - 500;
            return (
              <div
                key={para.id}
                ref={highlighted ? highlightRef : null}
                className={
                  highlighted
                    ? 'rounded-md border border-primary bg-primary/10 px-4 py-3 ring-1 ring-primary'
                    : 'rounded-md border border-border bg-muted/20 px-4 py-3'
                }
              >
                {source.signedUrl || source.filePath ? (
                  <button
                    type="button"
                    aria-label={`Jump to ${formatTimestamp(para.startMs)}`}
                    className="mr-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => setSeekMs(para.startMs)}
                  >
                    {formatTimestamp(para.startMs)}&ndash;{formatTimestamp(para.endMs)}
                  </button>
                ) : (
                  <span className="mr-2 text-xs font-medium text-primary">
                    {formatTimestamp(para.startMs)}&ndash;{formatTimestamp(para.endMs)}
                  </span>
                )}
                <span className="text-sm text-foreground">{para.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
