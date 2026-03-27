import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, PlayCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';

import { formatCitationLocator, formatTimestamp } from './time';

export interface ActiveVideoSource {
  title: string;
  signedUrl: string | null;
  materialId: string | null;
  startMs: number;
  endMs?: number;
  excerpt?: string;
}

interface TranscriptSegment {
  id: string;
  segment_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

interface VideoSourceDialogProps {
  source: ActiveVideoSource | null;
  onClose: () => void;
}

export function VideoSourceDialog({ source, onClose }: VideoSourceDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState(false);

  // Fetch transcript segments when showing transcript-only view
  useEffect(() => {
    if (!source?.materialId || source.signedUrl) {
      setSegments([]);
      return;
    }

    let cancelled = false;
    setIsLoadingSegments(true);

    supabase
      .from('material_transcript_segments')
      .select('id, segment_index, start_ms, end_ms, text')
      .eq('material_id', source.materialId)
      .order('segment_index', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Failed to load transcript segments:', error);
        }
        setSegments((data || []) as TranscriptSegment[]);
        setIsLoadingSegments(false);
      });

    return () => {
      cancelled = true;
    };
  }, [source?.materialId, source?.signedUrl]);

  // Seek video to start timestamp
  useEffect(() => {
    if (!source?.signedUrl || !videoRef.current) return;

    const video = videoRef.current;
    const seekToStart = () => {
      video.currentTime = Math.max(0, source.startMs / 1000);
    };

    if (video.readyState >= 1) {
      seekToStart();
    }
    video.addEventListener('loadedmetadata', seekToStart);
    return () => video.removeEventListener('loadedmetadata', seekToStart);
  }, [source]);

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
                    ref={videoRef}
                    src={source.signedUrl}
                    controls
                    className="max-h-[60vh] w-full rounded-lg bg-black"
                  />

                  {source.excerpt ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                      &ldquo;{source.excerpt}&rdquo;
                    </p>
                  ) : null}

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
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
                    The original video is not stored online. Contact your lecturer to access the original material.
                  </div>

                  {source.excerpt ? (
                    <div className="rounded-md bg-yellow-100/70 px-3 py-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Cited excerpt</p>
                      <p className="text-sm text-foreground/80">
                        &ldquo;{source.excerpt}&rdquo;
                      </p>
                    </div>
                  ) : null}

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
                        {segments.map((segment) => (
                          <div
                            key={segment.id}
                            className="rounded-md border border-border bg-muted/20 px-4 py-3"
                          >
                            <span className="mr-2 text-xs font-medium text-primary">
                              {formatTimestamp(segment.start_ms)}&ndash;{formatTimestamp(segment.end_ms)}
                            </span>
                            <span className="text-sm text-foreground">{segment.text}</span>
                          </div>
                        ))}
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
