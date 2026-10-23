import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';

const SIGNED_MEDIA_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signed-media`;

interface SignedMediaResponse {
  signedUrl?: string;
  expiresIn?: number;
  error?: string;
}

interface ResolveSignedMediaOptions {
  // Prefetch warmup: failures stay out of the UI and surface when the user actually opens the media.
  silent?: boolean;
}

interface CacheEntry {
  signedUrl: string;
  expiresAt: number;
}

// Signed URLs live for a bounded time, so cache them per material id and reuse
// them until they expire instead of hitting the edge function on every render.
const urlCache = new Map<string, CacheEntry>();
// A prefetch and a dialog open can race; both should share one edge-function call.
const inFlight = new Map<string, Promise<string>>();

const TTL_MS = (expiresSeconds: unknown): number =>
  typeof expiresSeconds === 'number' && Number.isFinite(expiresSeconds)
    ? expiresSeconds * 1000
    : 10 * 60 * 1000;

async function requestSignedMediaUrl(materialId: string): Promise<string> {
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.session?.access_token) {
    throw new Error(sessionError?.message || 'No active session.');
  }

  const response = await fetch(SIGNED_MEDIA_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ materialId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve image (${response.status}).`);
  }

  const payload = (await response.json()) as SignedMediaResponse;
  if (payload.error || !payload.signedUrl) {
    throw new Error(payload.error || 'No image URL returned.');
  }

  urlCache.set(materialId, {
    signedUrl: payload.signedUrl,
    expiresAt: Date.now() + TTL_MS(payload.expiresIn),
  });

  return payload.signedUrl;
}

export async function resolveSignedMediaUrl(
  materialId: string | null | undefined,
  options: ResolveSignedMediaOptions = {},
): Promise<string | null> {
  if (!materialId) return null;

  const cached = urlCache.get(materialId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.signedUrl;
  }

  let pending = inFlight.get(materialId);
  if (!pending) {
    pending = requestSignedMediaUrl(materialId).finally(() => {
      inFlight.delete(materialId);
    });
    inFlight.set(materialId, pending);
  }

  try {
    return await pending;
  } catch (error) {
    if (!options.silent) {
      const message = error instanceof Error ? error.message : 'Unable to load image.';
      console.error('signed-media resolution failed:', error);
      toast.error(message);
    }
    return null;
  }
}

export async function prefetchSignedMediaUrl(materialId: string | null | undefined): Promise<void> {
  await resolveSignedMediaUrl(materialId, { silent: true });
  // Warm the cache only; the caller must not depend on the result.
}

export function invalidateSignedMediaCache(materialId?: string | null | null): void {
  if (materialId) {
    urlCache.delete(materialId);
    inFlight.delete(materialId);
  } else {
    urlCache.clear();
    inFlight.clear();
  }
}
