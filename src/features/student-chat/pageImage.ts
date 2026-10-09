import { supabase } from '@/integrations/supabase/client';

import { isHighlightBox, type HighlightBox, type PageImage } from './documentViewer';

export const PAGE_IMAGE_URL_TTL_SECONDS = 600;

// Mirrors pageImagePath in supabase/functions/_shared/pageImages.ts.
export function pageImagePath(materialId: string, pageNumber: number): string {
  return `page-images/${materialId}/page-${pageNumber}.webp`;
}

// The cited page's pre-rendered image, or null when the material has none yet
// (not rendered, renderer off, or any lookup failure): callers then fall back
// to rendering the PDF in the browser.
export async function loadPageImage(materialId: string, pageNumber: number): Promise<PageImage | null> {
  const { data: page, error: pageError } = await supabase
    .from('material_pages')
    .select('width, height')
    .eq('material_id', materialId)
    .eq('page_number', pageNumber)
    .maybeSingle();

  if (pageError || !page) {
    return null;
  }

  const { data: signed, error: signError } = await supabase.storage
    .from('course-materials')
    .createSignedUrl(pageImagePath(materialId, pageNumber), PAGE_IMAGE_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    return null;
  }

  return { url: signed.signedUrl, width: page.width, height: page.height };
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
