import type { Citation } from './types';

export type ViewerKind = 'pdf' | 'video' | 'image' | 'other';

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
  thumbnailUrl?: string | null;
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
