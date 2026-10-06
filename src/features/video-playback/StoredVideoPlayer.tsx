import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';

const SIGNED_URL_SECONDS = 3600;
const RENEW_AFTER_MS = 50 * 60 * 1000;

interface StoredVideoPlayerProps {
  filePath?: string | null;
  initialUrl?: string | null;
  startMs: number;
  seekMs?: number;
  showOpenLink?: boolean;
}

export function StoredVideoPlayer({ filePath, initialUrl, startMs, seekMs, showOpenLink = false }: StoredVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const renewalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const resumePlayingRef = useRef(false);
  const errorRetryRef = useRef(0);
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [error, setError] = useState<string | null>(null);

  const renewUrl = useCallback(async (preservePosition: boolean) => {
    if (!filePath) return;
    const generation = generationRef.current;
    const video = videoRef.current;
    if (preservePosition && video) {
      pendingSeekRef.current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      resumePlayingRef.current = !video.paused;
    }

    const { data, error: signError } = await supabase.storage
      .from('course-materials')
      .createSignedUrl(filePath, SIGNED_URL_SECONDS);
    if (generation !== generationRef.current) return;
    if (signError || !data?.signedUrl) {
      setError(signError?.message || 'Unable to open this video.');
      return;
    }

    setError(null);
    setUrl(data.signedUrl);
    if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
    renewalTimerRef.current = setTimeout(() => { void renewUrl(true); }, RENEW_AFTER_MS);
  }, [filePath]);

  useEffect(() => {
    generationRef.current += 1;
    pendingSeekRef.current = Math.max(0, startMs / 1000);
    resumePlayingRef.current = false;
    errorRetryRef.current = 0;
    setError(null);
    setUrl(initialUrl ?? null);
    if (filePath) void renewUrl(false);

    return () => {
      generationRef.current += 1;
      if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
    };
  }, [filePath, initialUrl, startMs, renewUrl]);

  useEffect(() => {
    if (seekMs === undefined) return;
    const target = Math.max(0, seekMs / 1000);
    const video = videoRef.current;
    if (video) {
      video.currentTime = target;
    }
    if (!video || video.readyState < 1) {
      pendingSeekRef.current = target;
    }
  }, [seekMs]);

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const requested = pendingSeekRef.current;
    if (requested !== null) {
      video.currentTime = Number.isFinite(video.duration)
        ? Math.min(requested, video.duration)
        : requested;
      pendingSeekRef.current = null;
    }
    errorRetryRef.current = 0;
    if (resumePlayingRef.current) {
      resumePlayingRef.current = false;
      void video.play().catch(() => {});
    }
  };

  const onVideoError = () => {
    if (filePath && errorRetryRef.current < 1) {
      errorRetryRef.current += 1;
      void renewUrl(true);
      return;
    }
    setError('Video playback failed. Retry to request a fresh link.');
  };

  return (
    <div className="space-y-2">
      <video
        ref={videoRef}
        aria-label="Video playback"
        className="w-full rounded-md bg-black"
        controls
        preload="metadata"
        src={url ?? undefined}
        onLoadedMetadata={onLoadedMetadata}
        onError={onVideoError}
      />
      {showOpenLink && url ? (
        <div className="flex justify-end">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <ExternalLink className="h-3 w-3" />
            Open video
          </a>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
          <span>{error}</span>
          {filePath ? (
            <button type="button" className="underline" onClick={() => { errorRetryRef.current = 0; void renewUrl(true); }}>
              Retry video
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
