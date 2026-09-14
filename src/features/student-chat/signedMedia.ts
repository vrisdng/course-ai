import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';

const SIGNED_MEDIA_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signed-media`;

interface SignedMediaResponse {
  signedUrl?: string;
  expiresIn?: number;
  error?: string;
}

interface CacheEntry {
  signedUrl: string;
  expiresAt: number;
}

// Signed URLs live for a bounded time, so cache them per material id and reuse
// them until they expire instead of hitting the edge function on every render.
const urlCache = new Map<string, CacheEntry>();

const TTL_MS = (expiresSeconds: unknown): number =>
  typeof expiresSeconds === 'number' && Number.isFinite(expiresSeconds)
    ? expiresSeconds * 1000
    : 10 * 60 * 1000;

export async function resolveSignedMediaUrl(materialId: string | null | undefined): Promise<string | null> {
  if (!materialId) return null;

  const cached = urlCache.get(materialId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.signedUrl;
  }

  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load image.';
    console.error('signed-media resolution failed:', error);
    toast.error(message);
    return null;
  }
}

export function invalidateSignedMediaCache(materialId?: string | null | null): void {
  if (materialId) {
    urlCache.delete(materialId);
  } else {
    urlCache.clear();
  }
}
