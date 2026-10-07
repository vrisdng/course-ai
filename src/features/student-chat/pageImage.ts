import { supabase } from '@/integrations/supabase/client';

import type { PageImage } from './documentViewer';

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
