import { FileText, Loader2, PlayCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';

import { markCitationStep, markCitationTranscriptPainted } from './citationPerf';
import { formatCitationLocator, formatTimestamp } from './time';
import { useTranscriptWindow } from './useTranscriptWindow';
import type { ActiveVideoSource } from './VideoSourceDialog';

interface VideoTranscriptProps {
  source: ActiveVideoSource;
  onOpenVideo: () => void;
}

export function VideoTranscript({ source, onOpenVideo }: VideoTranscriptProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const { segments, isLoading } = useTranscriptWindow(source.materialId, source.startMs, source.endMs);
  const hasPlayback = Boolean(source.signedUrl || source.filePath);
  const citedEndMs = source.endMs ?? source.startMs;
  const evidence = source.evidenceSegments?.length ? source.evidenceSegments : null;
  const evidenceRows = evidence?.map((segment) => ({
    id: segment.id,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    text: segment.text,
  })) ?? [];
  const evidenceIds = new Set(evidence?.map((segment) => segment.id));
  const visibleIds = new Set(segments.map((segment) => segment.id));
  const missingEvidence = evidence?.filter((segment) => !visibleIds.has(segment.id)) ?? [];
  // Persisted evidence is already in memory, so show it before the window query
  // returns instead of making the sidebar wait for another round trip.
  const visibleSegments = segments.length > 0 ? segments : evidenceRows;
  const transcriptSource = segments.length > 0 ? 'window' : evidenceRows.length > 0 ? 'evidence' : 'empty';
  const firstCitedIndex = visibleSegments.findIndex((segment) =>
    evidence ? evidenceIds.has(segment.id) : segment.start_ms <= citedEndMs && segment.end_ms >= source.startMs
  );

  useLayoutEffect(() => {
    markCitationStep('placeholder_visible');
  }, [source.materialId, source.startMs, source.endMs]);

  useLayoutEffect(() => {
    if (visibleSegments.length === 0) return;
    const mark = () => markCitationTranscriptPainted(transcriptSource);
    if (typeof requestAnimationFrame === 'function') {
      const frame = requestAnimationFrame(mark);
      return () => cancelAnimationFrame(frame);
    }
    const timeout = window.setTimeout(mark, 0);
    return () => window.clearTimeout(timeout);
  }, [source.materialId, source.startMs, source.endMs, transcriptSource, visibleSegments.length]);

  useEffect(() => {
    if (!highlightRef.current || isLoading) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [firstCitedIndex, isLoading, visibleSegments.length]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start gap-2">
        <FileText className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{source.title}</p>
          <p className="text-xs text-muted-foreground">
            Source interval: {formatCitationLocator({ startMs: source.startMs, endMs: source.endMs })}
          </p>
          <p className="text-xs text-muted-foreground">
            {evidence ? 'Exact supporting segments' : 'Approximate citation interval'}
          </p>
        </div>
      </div>

      {hasPlayback ? (
        <div className="shrink-0 space-y-2">
          <button
            type="button"
            aria-label={`Open video preview for ${source.title}`}
            onClick={onOpenVideo}
            className="relative block aspect-video w-full overflow-hidden rounded-md bg-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="absolute inset-0 flex items-center justify-center bg-black/20">
              <PlayCircle className="h-12 w-12 drop-shadow" aria-hidden="true" />
            </span>
          </button>
          <Button type="button" variant="outline" className="w-full" onClick={onOpenVideo}>
            View video with transcription
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {!isLoading && missingEvidence.length > 0 ? (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Evidence from an earlier transcript</p>
            {missingEvidence.map((segment) => (
              <p key={segment.id}>{formatTimestamp(segment.startMs)}–{formatTimestamp(segment.endMs)} {segment.text}</p>
            ))}
          </div>
        ) : null}
        {isLoading && visibleSegments.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading transcript...
          </div>
        ) : visibleSegments.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No transcript segments available.</div>
        ) : visibleSegments.map((segment, index) => {
          const cited = evidence ? evidenceIds.has(segment.id) : segment.start_ms <= citedEndMs && segment.end_ms >= source.startMs;
          return (
            <div
              key={`${segment.start_ms}-${segment.end_ms}-${index}`}
              ref={index === firstCitedIndex ? highlightRef : null}
              data-cited={cited}
              className={cited
                ? 'rounded-md border border-primary bg-primary/10 px-3 py-2 ring-1 ring-primary'
                : 'rounded-md border border-border bg-muted/20 px-3 py-2'}
            >
              <span className="mr-2 text-xs font-medium text-primary">
                {formatTimestamp(segment.start_ms)}–{formatTimestamp(segment.end_ms)}
              </span>
              <span className="text-sm text-foreground">{segment.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
