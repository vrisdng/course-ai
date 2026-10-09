import { ExternalLink, FileText, Loader2, PlayCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StoredVideoPlayer } from '@/features/video-playback/StoredVideoPlayer';
import { supabase } from '@/integrations/supabase/client';

import type { RawSegment } from './groupTranscriptSegments';
import { formatCitationLocator, formatTimestamp } from './time';

export interface ActiveVideoSource {
  title: string;
  signedUrl: string | null;
  filePath?: string | null;
  materialId: string | null;
  startMs: number;
  endMs?: number;
  excerpt?: string;
  linkedUrl?: string | null;
}

interface VideoSourceDialogProps {
  source: ActiveVideoSource | null;
  onClose: () => void;
}

interface TranscriptRow extends RawSegment {
  id: string;
  segment_index: number;
}

const TRANSCRIPT_PAGE_SIZE = 500;

export function VideoSourceDialog({ source, onClose }: VideoSourceDialogProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const seekIdRef = useRef(0);
  const [seekRequest, setSeekRequest] = useState<{ ms: number; id: number } | null>(null);
  const [segments, setSegments] = useState<TranscriptRow[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const materialId = source?.materialId;

  useEffect(() => {
    setSeekRequest(null);
  }, [source?.materialId, source?.startMs, source?.endMs]);

  useEffect(() => {
    if (!materialId) {
      setSegments([]);
      setIsLoadingSegments(false);
      setLoadError(false);
      return;
    }

    let cancelled = false;
    setSegments([]);
    setIsLoadingSegments(true);
    setLoadError(false);

    const load = async () => {
      const loaded: TranscriptRow[] = [];
      for (let from = 0; !cancelled; from += TRANSCRIPT_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('material_transcript_segments')
          .select('id, segment_index, start_ms, end_ms, text')
          .eq('material_id', materialId)
          .order('segment_index', { ascending: true })
          .range(from, from + TRANSCRIPT_PAGE_SIZE - 1);
        if (cancelled) return;
        if (error) {
          console.error('Failed to load transcript segments:', error);
          setLoadError(true);
          break;
        }
        loaded.push(...(data ?? []));
        setSegments([...loaded]);
        if (!data || data.length < TRANSCRIPT_PAGE_SIZE) break;
      }
      if (!cancelled) setIsLoadingSegments(false);
    };
    void load();

    return () => { cancelled = true; };
  }, [materialId]);

  const citedEndMs = source?.endMs ?? source?.startMs ?? 0;
  const firstCitedIndex = segments.findIndex((segment) =>
    segment.start_ms <= citedEndMs && segment.end_ms >= (source?.startMs ?? 0)
  );

  useEffect(() => {
    if (isLoadingSegments || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [firstCitedIndex, isLoadingSegments, segments]);

  const hasPlayback = Boolean(source?.signedUrl || source?.filePath);
  const externalUrl = source?.linkedUrl ? (() => {
    try {
      const url = new URL(source.linkedUrl);
      url.searchParams.set('t', String(Math.floor(source.startMs / 1000)));
      return url.toString();
    } catch {
      return source.linkedUrl;
    }
  })() : null;

  return (
    <Dialog open={Boolean(source)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[96vw] max-w-6xl flex-col overflow-hidden p-0 sm:max-w-6xl">
        {source ? (
          <>
            <DialogHeader className="shrink-0 border-b px-5 py-4">
              <DialogTitle className="flex items-center gap-2 text-base">
                {hasPlayback ? <PlayCircle className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}
                {source.title}
              </DialogTitle>
              <DialogDescription>
                Cited segment: {formatCitationLocator({ startMs: source.startMs, endMs: source.endMs })}
              </DialogDescription>
            </DialogHeader>

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
              <div className="min-h-0 overflow-y-auto border-b p-4 md:border-b-0 md:border-r">
                {hasPlayback ? (
                  <StoredVideoPlayer
                    materialId={source.materialId}
                    filePath={source.filePath}
                    initialUrl={source.signedUrl}
                    startMs={source.startMs}
                    seekRequest={seekRequest ?? undefined}
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
                      const cited = segment.start_ms <= citedEndMs && segment.end_ms >= source.startMs;
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
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
