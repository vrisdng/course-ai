import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { invalidateSignedMediaCache, resolveSignedMediaUrl } from '@/features/student-chat/signedMedia';
import { supabase } from '@/integrations/supabase/client';

const SIGNED_URL_SECONDS = 3600;
const RENEW_AFTER_MS = 8 * 60 * 1000;

interface StoredVideoPlayerProps {
  materialId?: string | null;
  filePath?: string | null;
  initialUrl?: string | null;
  startMs: number;
  seekMs?: number;
  seekRequest?: { ms: number; id: number };
  showOpenLink?: boolean;
}

export function StoredVideoPlayer({ materialId, filePath, initialUrl, startMs, seekMs, seekRequest, showOpenLink = false }: StoredVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const renewalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const resumePlayingRef = useRef(false);
  const errorRetryRef = useRef(0);
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [error, setError] = useState<string | null>(null);

  const renewUrl = useCallback(async (preservePosition: boolean) => {
    if (!materialId && !filePath) return;
    const generation = generationRef.current;
    const video = videoRef.current;
    if (preservePosition && video) {
      pendingSeekRef.current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      resumePlayingRef.current = !video.paused;
    }

    let signedUrl: string | null = null;
    let signError: string | null = null;
    if (materialId) {
      if (preservePosition) invalidateSignedMediaCache(materialId);
      signedUrl = await resolveSignedMediaUrl(materialId);
      if (!signedUrl) signError = 'Unable to open this video.';
    } else if (filePath) {
      const { data, error: storageError } = await supabase.storage
        .from('course-materials')
        .createSignedUrl(filePath, SIGNED_URL_SECONDS);
      signedUrl = data?.signedUrl ?? null;
      signError = storageError?.message ?? null;
    }
    if (generation !== generationRef.current) return;
    if (signError || !signedUrl) {
      setError(signError || 'Unable to open this video.');
      return;
    }

    setError(null);
    setUrl(signedUrl);
    if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
    renewalTimerRef.current = setTimeout(() => { void renewUrl(true); }, RENEW_AFTER_MS);
  }, [filePath, materialId]);

  useEffect(() => {
    generationRef.current += 1;
    pendingSeekRef.current = Math.max(0, startMs / 1000);
    resumePlayingRef.current = false;
    errorRetryRef.current = 0;
    setError(null);
    setUrl(initialUrl ?? null);
    if (materialId || filePath) void renewUrl(false);

    return () => {
      generationRef.current += 1;
      if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
    };
  }, [filePath, initialUrl, materialId, startMs, renewUrl]);

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

  useEffect(() => {
    if (!seekRequest) return;
    const target = Math.max(0, seekRequest.ms / 1000);
    const video = videoRef.current;
    if (!video || video.readyState < 1) {
      pendingSeekRef.current = target;
      resumePlayingRef.current = true;
    }
    if (video) {
      video.currentTime = target;
      void video.play().catch(() => {
        setError('Playback was blocked. Press play on the video.');
      });
    }
  }, [seekRequest]);

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
      void video.play().catch(() => {
        setError('Playback was blocked. Press play on the video.');
      });
    }
  };

  const onVideoError = () => {
    if ((materialId || filePath) && errorRetryRef.current < 1) {
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
          {materialId || filePath ? (
            <button type="button" className="underline" onClick={() => { errorRetryRef.current = 0; void renewUrl(true); }}>
              Retry video
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
