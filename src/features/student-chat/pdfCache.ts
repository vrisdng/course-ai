import { supabase } from '@/integrations/supabase/client';

import type { SourceStorage } from './documentViewer';

// PDFs are downloaded whole, once, the first time they're opened, then served
// from memory for the session. pdf.js would otherwise keep fetching ranges
// from the signed link while the reader is open, so a link that expires
// mid-read breaks pages that haven't loaded yet.
export const PDF_LINK_TTL_SECONDS = 600;
export const MAX_CACHED_PDFS = 3;

// Most recently used last. Holding the promise lets concurrent callers share
// one download.
const cache = new Map<string, Promise<Blob>>();

function cacheKey({ bucket, path }: SourceStorage): string {
  return `${bucket}/${path}`;
}

async function download({ bucket, path }: SourceStorage): Promise<Blob> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, PDF_LINK_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Unable to create a link to the PDF');
  }
  const response = await fetch(data.signedUrl);
  if (!response.ok) {
    throw new Error(`PDF download failed (${response.status})`);
  }
  return response.blob();
}

export function getCachedPdf(storage: SourceStorage): Promise<Blob> {
  const key = cacheKey(storage);
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }

  const pending = download(storage).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  while (cache.size > MAX_CACHED_PDFS) {
    cache.delete(cache.keys().next().value as string);
  }
  return pending;
}

export function clearPdfCache(): void {
  cache.clear();
}
