import { ExternalLink, FileText, Loader2, PlayCircle, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { StoredVideoPlayer } from '@/features/video-playback/StoredVideoPlayer';

import { formatCitationLocator, formatTimestamp } from './time';
import { getCachedTranscript, peekCachedTranscript, type TranscriptSegment } from './transcriptCache';
import type { VideoEvidenceSegment } from './types';

export interface ActiveVideoSource {
  title: string;
  signedUrl: string | null;
  filePath?: string | null;
  materialId: string | null;
  startMs: number;
  endMs?: number;
  excerpt?: string;
  linkedUrl?: string | null;
  evidenceSegments?: VideoEvidenceSegment[] | null;
}

interface VideoSourceDialogProps {
  source: ActiveVideoSource | null;
  open: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), video, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function VideoSourceDialog({ source, open, onClose }: VideoSourceDialogProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const seekIdRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const [lastSource, setLastSource] = useState<ActiveVideoSource | null>(null);
  const [seekRequest, setSeekRequest] = useState<{ ms: number; id: number } | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!source) {
      setLastSource(null);
      return;
    }
    if (open) setLastSource(source);
  }, [open, source]);

  const shownSource = open ? source : lastSource;
  const materialId = shownSource?.materialId ?? null;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const previous = previousFocusRef.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    setSeekRequest(null);
  }, [shownSource?.materialId, shownSource?.startMs, shownSource?.endMs]);

  useEffect(() => {
    if (!materialId) {
      setSegments([]);
      setIsLoadingSegments(false);
      setLoadError(false);
      return;
    }

    const cached = peekCachedTranscript(materialId);
    if (cached) {
      setSegments(cached);
      setIsLoadingSegments(false);
      setLoadError(false);
      return;
    }

    let cancelled = false;
    setSegments([]);
    setIsLoadingSegments(true);
    setLoadError(false);

    getCachedTranscript(materialId, (partial) => {
      if (!cancelled) setSegments(partial);
    })
      .then((loaded) => {
        if (!cancelled) setSegments(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Failed to load transcript segments:', error);
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSegments(false);
      });

    return () => {
      cancelled = true;
    };
  }, [materialId]);

  const citedEndMs = shownSource?.endMs ?? shownSource?.startMs ?? 0;
  const evidence = shownSource?.evidenceSegments?.length ? shownSource.evidenceSegments : null;
  const evidenceIds = new Set(evidence?.map((segment) => segment.id));
  const visibleIds = new Set(segments.map((segment) => segment.id));
  const missingEvidence = evidence?.filter((segment) => !visibleIds.has(segment.id)) ?? [];
  const firstCitedIndex = segments.findIndex((segment) =>
    evidence
      ? evidenceIds.has(segment.id)
      : segment.start_ms <= citedEndMs && segment.end_ms >= (shownSource?.startMs ?? 0),
  );

  useEffect(() => {
    if (isLoadingSegments || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [firstCitedIndex, isLoadingSegments, segments]);

  if (!shownSource) return null;

  const hasPlayback = Boolean(shownSource.signedUrl || shownSource.filePath);
  const externalUrl = shownSource.linkedUrl ? (() => {
    try {
      const url = new URL(shownSource.linkedUrl);
      url.searchParams.set('t', String(Math.floor(shownSource.startMs / 1000)));
      return url.toString();
    } catch {
      return shownSource.linkedUrl;
    }
  })() : null;

  return createPortal(
    <div className="fixed inset-0 z-50" hidden={!open}>
      <div className="absolute inset-0 bg-black/80" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 flex h-[90dvh] max-h-[90dvh] w-[96vw] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border bg-background p-0 shadow-lg sm:rounded-lg"
      >
        <div className="flex shrink-0 flex-col space-y-1.5 border-b px-5 py-4 pr-12 text-center sm:text-left">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
            {hasPlayback ? <PlayCircle className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}
            {shownSource.title}
          </h2>
          <p id={descriptionId} className="text-sm text-muted-foreground">
            Source interval: {formatCitationLocator({ startMs: shownSource.startMs, endMs: shownSource.endMs })}
          </p>
        </div>

        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close video"
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
          <div className="min-h-0 overflow-y-auto border-b p-4 md:border-b-0 md:border-r">
            {hasPlayback ? (
              <StoredVideoPlayer
                materialId={shownSource.materialId}
                filePath={shownSource.filePath}
                initialUrl={shownSource.signedUrl}
                startMs={evidence?.[0]?.startMs ?? shownSource.startMs}
                seekRequest={seekRequest ?? undefined}
                active={open}
              />
            ) : externalUrl ? (
              <Button asChild variant="outline">
                <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />Go to original video
                </a>
              </Button>
            ) : (
              <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                The original video is not stored online. Contact your lecturer to access it.
              </p>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto p-4" aria-label="Video transcript">
            <h3 className="mb-3 text-sm font-semibold">Transcription</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {evidence ? 'Exact supporting segments' : 'Approximate citation interval'}
            </p>
            {!isLoadingSegments && missingEvidence.length > 0 ? (
              <div className="mb-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">Evidence from an earlier transcript</p>
                {missingEvidence.map((segment) => (
                  <p key={segment.id}>{formatTimestamp(segment.startMs)}–{formatTimestamp(segment.endMs)} {segment.text}</p>
                ))}
              </div>
            ) : null}
            {loadError ? <p role="alert" className="mb-3 text-sm text-destructive">Unable to load transcript.</p> : null}
            {isLoadingSegments && segments.length === 0 ? (
              <div className="flex items-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading transcript...
              </div>
            ) : segments.length === 0 && !loadError ? (
              <p className="py-6 text-sm text-muted-foreground">No transcript segments available.</p>
            ) : (
              <div className="space-y-2">
                {segments.map((segment, index) => {
                  const cited = evidence
                    ? evidenceIds.has(segment.id)
                    : segment.start_ms <= citedEndMs && segment.end_ms >= shownSource.startMs;
                  return (
                    <div
                      key={segment.id}
                      ref={index === firstCitedIndex ? highlightRef : null}
                      data-cited={cited}
                      className={cited
                        ? 'rounded-md border border-primary bg-primary/10 px-3 py-2 ring-1 ring-primary'
                        : 'rounded-md border border-border bg-muted/20 px-3 py-2'}
                    >
                      {hasPlayback ? (
                        <button
                          type="button"
                          aria-label={`Play from ${formatTimestamp(segment.start_ms)}`}
                          className="mr-2 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:underline"
                          onClick={() => setSeekRequest({ ms: segment.start_ms, id: ++seekIdRef.current })}
                        >
                          {formatTimestamp(segment.start_ms)}–{formatTimestamp(segment.end_ms)}
                        </button>
                      ) : (
                        <span className="mr-2 text-xs font-medium text-primary">
                          {formatTimestamp(segment.start_ms)}–{formatTimestamp(segment.end_ms)}
                        </span>
                      )}
                      <span className="text-sm leading-relaxed">{segment.text}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
