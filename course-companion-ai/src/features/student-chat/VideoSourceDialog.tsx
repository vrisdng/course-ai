import { useEffect, useRef } from 'react';
import { ExternalLink, PlayCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { formatCitationLocator } from './time';

export interface ActiveVideoSource {
  title: string;
  signedUrl: string;
  startMs: number;
  endMs?: number;
  excerpt?: string;
}

interface VideoSourceDialogProps {
  source: ActiveVideoSource | null;
  onClose: () => void;
}

export function VideoSourceDialog({ source, onClose }: VideoSourceDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!source || !videoRef.current) {
      return;
    }

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
                <PlayCircle className="h-4 w-4 text-primary" />
                {source.title}
              </DialogTitle>
              <DialogDescription>
                Cited segment: {formatCitationLocator({ startMs: source.startMs, endMs: source.endMs })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 p-6">
              <video
                ref={videoRef}
                src={source.signedUrl}
                controls
                className="max-h-[60vh] w-full rounded-lg bg-black"
              />

              {source.excerpt ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  "{source.excerpt}"
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
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
