import type { Citation } from './types';

export type ViewerKind = 'pdf' | 'video' | 'image' | 'other';

// A cited chunk's location on its page: [x0, y0, x1, y1] as fractions of the
// page width/height, top-left origin. Written at ingestion into
// chunks.highlight_box (supabase/functions/_shared/highlights.ts).
export type HighlightBox = [number, number, number, number];

// A pre-rendered page image (material_pages + page-images/ in storage).
export interface PageImage {
  url: string;
  width: number;
  height: number;
}

// The in-app viewer holds exactly one open source at a time. It is replaced (never
// merged) on each citation open, so it models a single document open request.
export interface ActiveViewerSource {
  kind: ViewerKind;
  documentName: string;
  pageNumber?: number;      // null → page 1 (ensureStartingPage)
  signedUrl?: string | null;
  materialId?: string | null;
  startMs?: number;
  endMs?: number;
  excerpt?: string;
  // Set for PDF pages rendered at ingestion; the viewer then shows the image
  // (with highlightBoxes outlined on it) instead of loading the whole PDF.
  pageImage?: PageImage | null;
  // The cited blocks' boxes, or the whole chunk's box when no blocks were cited.
  highlightBoxes?: HighlightBox[];
}

export function isHighlightBox(value: unknown): value is HighlightBox {
  if (!Array.isArray(value) || value.length !== 4) return false;
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return false;
  const [x0, y0, x1, y1] = value as number[];
  return x0 < x1 && y0 < y1;
}

// Mirrors the backend IMAGE_MATERIAL_TYPES in _shared/citations.ts so a citation
// classified on the client matches the storage bucket it was embedded from.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

export function isImageDocumentType(type: string | undefined | null): boolean {
  return type != null && IMAGE_EXTENSIONS.has(type.toLowerCase());
}

// Pure decision: which in-app viewer a citation should open. Deliberately
// ignores Supabase — the signed-URL/file lookup stays in the hook so this stays
// unit-testable without a database.
export function classifyCitation(citation: Citation): ViewerKind {
  const type = citation.documentType;
  if (type === 'video') return 'video';
  if (isImageDocumentType(type)) return 'image';
  if (type === 'pdf') return 'pdf';
  return 'other';
}

// Viewers are 1-based. A null page_number (OCR lost the page mark, or a
// transcript-style chunk) still renders at page 1 instead of failing.
export function ensureStartingPage(pageNumber: number | null | undefined): number {
  return typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber >= 1
    ? pageNumber
    : 1;
}
