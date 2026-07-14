import { ExternalLink, FileText, Loader2, PlayCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';

import { groupSegmentsIntoParagraphs } from './groupTranscriptSegments';
import { formatCitationLocator, formatTimestamp } from './time';

export interface ActiveVideoSource {
  title: string;
  signedUrl: string | null;
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

const CONTEXT_WINDOW_MS = 30_000; // 30s before and after the cited segment

export function VideoSourceDialog({ source, onClose }: VideoSourceDialogProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const [segments, setSegments] = useState<{ id: string; segment_index: number; start_ms: number; end_ms: number; text: string }[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState(false);

  // Fetch transcript segments windowed around the cited segment
  useEffect(() => {
    if (!source?.materialId || source.signedUrl) {
      setSegments([]);
      return;
    }

    let cancelled = false;
    setIsLoadingSegments(true);

    const windowStart = Math.max(0, source.startMs - CONTEXT_WINDOW_MS);
    const windowEnd = (source.endMs ?? source.startMs) + CONTEXT_WINDOW_MS;

    supabase
      .from('material_transcript_segments')
      .select('id, segment_index, start_ms, end_ms, text')
      .eq('material_id', source.materialId)
      .gte('start_ms', windowStart)
      .lte('start_ms', windowEnd)
      .order('segment_index', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('Failed to load transcript segments:', error);
        setSegments(data || []);
        setIsLoadingSegments(false);
      });

    return () => { cancelled = true; };
  }, [source?.materialId, source?.signedUrl, source?.startMs, source?.endMs]);

  // Scroll to highlighted segment after load
  useEffect(() => {
    if (!highlightRef.current || isLoadingSegments) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [segments, isLoadingSegments]);

  return (
    <Dialog open={Boolean(source)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-4xl">
        {source ? (
          <div className="grid gap-0">
            <DialogHeader className="border-b px-6 py-4">
              <DialogTitle className="flex items-center gap-2 text-base">
                {source.signedUrl ? (
                  <PlayCircle className="h-4 w-4 text-primary" />
                ) : (
                  <FileText className="h-4 w-4 text-primary" />
                )}
                {source.title}
              </DialogTitle>
              <DialogDescription>
                Cited segment: {formatCitationLocator({ startMs: source.startMs, endMs: source.endMs })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 p-6">
              {source.signedUrl ? (
                /* Video playback mode */
                <>
                  <video
                    src={source.signedUrl}
                    controls
                    onLoadedMetadata={(event) => {
                      event.currentTarget.currentTime = Math.max(0, source.startMs / 1000);
                    }}
                    className="max-h-[60vh] w-full rounded-lg bg-black"
                  />
                  <div className="flex justify-end">
                    <Button asChild variant="outline">
                      <a href={source.signedUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open video in new tab
                      </a>
                    </Button>
                  </div>
                </>
              ) : (
                /* Transcript-only mode */
                <>
                  {source.linkedUrl ? (
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                      <span className="text-xs text-muted-foreground">Original video available externally.</span>
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={(() => {
                            try {
                              const url = new URL(source.linkedUrl);
                              url.searchParams.set('t', String(Math.floor(source.startMs / 1000)));
                              return url.toString();
                            } catch {
                              return source.linkedUrl;
                            }
                          })()}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-2 h-3 w-3" />
                          Go to original video
                        </a>
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
                      The original video is not stored online. Contact your lecturer to access the original material.
                    </div>
                  )}

                  <div className="max-h-[50vh] overflow-y-auto">
                    {isLoadingSegments ? (
                      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading transcript...
                      </div>
                    ) : segments.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No transcript segments available.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {groupSegmentsIntoParagraphs(segments).map((para) => {
                          const highlighted = source
                            ? para.startMs <= (source.endMs ?? source.startMs) + 500 &&
                              para.endMs >= source.startMs - 500
                            : false;
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
                              <span className="mr-2 text-xs font-medium text-primary">
                                {formatTimestamp(para.startMs)}&ndash;{formatTimestamp(para.endMs)}
                              </span>
                              <span className="text-sm text-foreground">{para.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
