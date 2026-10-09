import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ensureStartingPage, type ActiveViewerSource } from './documentViewer';

const workerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfReaderProps {
  source: ActiveViewerSource;
}

export const THUMBNAIL_WIDTH = 112;
// Breathing room around the page inside the viewer (16px each side).
const PAGE_PADDING = 32;
const MIN_PAGE_WIDTH = 200;

interface ViewerSize {
  width: number;
  height: number;
}

// Widest the page can be while fitting the viewer in both directions, so it
// never overflows. Until the page's shape is known, fit the width only.
function fitPageWidth(viewer: ViewerSize, aspectRatio: number | null): number {
  const availableWidth = viewer.width - PAGE_PADDING;
  const availableHeight = viewer.height - PAGE_PADDING;
  const width = aspectRatio ? Math.min(availableWidth, availableHeight * aspectRatio) : availableWidth;
  return Math.max(MIN_PAGE_WIDTH, Math.floor(width));
}

// The "View document" reader: page thumbnails in a sidebar, the current page
// sized to fit, and a page-number box for jumping to any page. All pages come
// from one loaded document.
export function PdfReader({ source }: PdfReaderProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const activeThumbnailRef = useRef<HTMLButtonElement | null>(null);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(() => ensureStartingPage(source.pageNumber));
  const [pageDraft, setPageDraft] = useState(() => String(ensureStartingPage(source.pageNumber)));
  const [viewer, setViewer] = useState<ViewerSize>({ width: 0, height: 0 });
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  const file = useMemo(
    () => (source.signedUrl ? { url: source.signedUrl } : false),
    [source.signedUrl],
  );

  // Reset whenever the source (or its page) changes so stale pages don't linger.
  useEffect(() => {
    setNumPages(null);
    setAspectRatio(null);
    setCurrentPage(ensureStartingPage(source.pageNumber));
  }, [source.signedUrl, source.pageNumber]);

  useEffect(() => {
    setPageDraft(String(currentPage));
    activeThumbnailRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentPage]);

  // Track the viewer's size so the page is re-fitted when the dialog resizes.
  useEffect(() => {
    const element = viewerRef.current;
    if (!element) {
      return;
    }
    const measure = () => setViewer({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [file]);

  const pageWidth = fitPageWidth(viewer, aspectRatio);

  const goToPage = useCallback(
    (next: number) => {
      const last = numPages ?? next;
      setCurrentPage(Math.max(1, Math.min(last, next)));
    },
    [numPages],
  );

  // Applies the typed page number: out-of-range numbers are clamped, anything
  // that isn't a number puts the current page back.
  const commitPageDraft = useCallback(() => {
    const requested = Number.parseInt(pageDraft, 10);
    if (Number.isNaN(requested)) {
      setPageDraft(String(currentPage));
      return;
    }
    const clamped = Math.max(1, Math.min(numPages ?? requested, requested));
    setCurrentPage(clamped);
    setPageDraft(String(clamped));
  }, [pageDraft, currentPage, numPages]);

  const pages = useMemo(
    () => Array.from({ length: numPages ?? 0 }, (_, index) => index + 1),
    [numPages],
  );

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
        No document available to preview.
      </div>
    );
  }

  return (
    <Document
      file={file}
      onLoadSuccess={({ numPages: total }) => setNumPages(total)}
      loading={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading document…</div>}
      className="flex h-full min-h-0 bg-muted/20"
    >
      <nav
        aria-label="Pages"
        className="hidden w-40 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-muted/30 p-3 sm:flex"
      >
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            ref={page === currentPage ? activeThumbnailRef : undefined}
            onClick={() => goToPage(page)}
            aria-label={`Page ${page}`}
            aria-pressed={page === currentPage}
            className={cn(
              'flex shrink-0 flex-col items-center gap-1 rounded-md p-1 transition-colors',
              page === currentPage ? 'bg-yellow-100 ring-2 ring-yellow-400' : 'hover:bg-muted',
            )}
          >
            <Page
              pageNumber={page}
              width={THUMBNAIL_WIDTH}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="overflow-hidden rounded-sm border border-border bg-background"
              loading={<div className="h-36 w-28 rounded-sm bg-background" />}
            />
            <span className="text-[11px] font-medium text-muted-foreground">{page}</span>
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={viewerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
          <Page
            pageNumber={currentPage}
            width={pageWidth}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onLoadSuccess={(page) => setAspectRatio(page.originalWidth / page.originalHeight)}
            className="overflow-hidden rounded-md border border-border bg-background shadow-sm"
            loading={<div className="text-sm text-muted-foreground">Loading page…</div>}
            error={
              <div className="text-center text-sm text-destructive">
                Unable to load this page. It may have expired or been removed.
              </div>
            }
          />
        </div>

        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border bg-muted/30 px-3 py-2">
          <Button
            size="icon"
            variant="outline"
            aria-label="Previous page"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            Page
            <input
              type="number"
              inputMode="numeric"
              aria-label="Page number"
              min={1}
              max={numPages ?? undefined}
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value)}
              onBlur={commitPageDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitPageDraft();
              }}
              className="h-8 w-14 rounded-md border border-input bg-background px-2 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-muted-foreground">{numPages !== null ? `/ ${numPages}` : ''}</span>
          </label>
          <Button
            size="icon"
            variant="outline"
            aria-label="Next page"
            onClick={() => goToPage(currentPage + 1)}
            disabled={numPages !== null && currentPage >= numPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Document>
  );
}
