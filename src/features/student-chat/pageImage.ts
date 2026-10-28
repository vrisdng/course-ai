import { supabase } from '@/integrations/supabase/client';

import { isHighlightBox, type HighlightBox, type PageImage } from './documentViewer';

export const PAGE_IMAGE_URL_TTL_SECONDS = 600;

// Repeat opens of the same citation reuse the signed page image for a minute;
// the signed URL itself is valid for PAGE_IMAGE_URL_TTL_SECONDS.
const PAGE_IMAGE_CACHE_TTL_MS = 60_000;
const pageImageCache = new Map<string, { image: PageImage; expiresAt: number }>();

export function clearPageImageCache(): void {
  pageImageCache.clear();
}

// Mirrors pageImagePath in supabase/functions/_shared/pageImages.ts.
export function pageImagePath(materialId: string, pageNumber: number): string {
  return `page-images/${materialId}/page-${pageNumber}.webp`;
}

// The cited page's pre-rendered image, or null when the material has none yet
// (not rendered, renderer off, or any lookup failure): callers then fall back
// to rendering the PDF in the browser.
export async function loadPageImage(materialId: string, pageNumber: number): Promise<PageImage | null> {
  const cacheKey = `${materialId}:${pageNumber}`;
  const cached = pageImageCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.image;
  }

  // The storage path is deterministic, so the signing request can run while
  // the page row loads; a missing row just discards the signed URL.
  const [pageResult, signedResult] = await Promise.all([
    supabase
      .from('material_pages')
      .select('width, height')
      .eq('material_id', materialId)
      .eq('page_number', pageNumber)
      .maybeSingle(),
    supabase.storage
      .from('course-materials')
      .createSignedUrl(pageImagePath(materialId, pageNumber), PAGE_IMAGE_URL_TTL_SECONDS),
  ]);

  const { data: page, error: pageError } = pageResult;
  const { data: signed, error: signError } = signedResult;
  if (pageError || !page || signError || !signed?.signedUrl) {
    return null;
  }

  const image: PageImage = { url: signed.signedUrl, width: page.width, height: page.height };
  // Rendered pages are immutable and the signed URL outlives this TTL, so
  // re-opening the same citation skips both round trips. Failures stay
  // uncached: the page may render at any moment.
  pageImageCache.set(cacheKey, { image, expiresAt: Date.now() + PAGE_IMAGE_CACHE_TTL_MS });
  return image;
}

export interface BlockHighlight {
  pageNumber: number;
  boxes: HighlightBox[];
}

// Where cited page blocks sit: the page of the first cited block, and the
// boxes of the cited blocks on that page in citation order. Null when the
// blocks can't be read, so callers fall back to the chunk's box.
export async function loadBlockBoxes(blockIds: string[]): Promise<BlockHighlight | null> {
  if (blockIds.length === 0) return null;

  const { data, error } = await supabase
    .from('page_blocks')
    .select('id, page_number, box')
    .in('id', blockIds);
  if (error || !data || data.length === 0) return null;

  const byId = new Map(data.map((row) => [row.id, row]));
  const ordered = blockIds.map((id) => byId.get(id)).filter((row): row is (typeof data)[number] => Boolean(row));
  const pageNumber = ordered[0].page_number;
  const boxes = ordered
    .filter((row) => row.page_number === pageNumber)
    .map((row) => row.box)
    .filter(isHighlightBox);
  return { pageNumber, boxes };
}
