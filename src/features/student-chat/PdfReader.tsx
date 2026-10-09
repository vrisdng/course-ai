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
// Pages within this distance of the current page are drawn; the rest keep
// their space as placeholders so long documents stay fast.
const RENDER_WINDOW = 3;
// The current page is the last one whose top has scrolled above this share
// of the viewer's height.
const CURRENT_PAGE_LINE = 1 / 3;

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

// The "View document" reader: every page in one continuous scroll (each sized
// to fit the viewer's height), thumbnails in a sidebar, and a page-number box
// for jumping to any page. All pages come from one loaded document.
export function PdfReader({ source }: PdfReaderProps) {
  const viewerObserverRef = useRef<ResizeObserver | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const anchorsRef = useRef(new Map<number, HTMLDivElement>());
  // Until the page shape is known, placeholder heights are guesses, so the
  // opening scroll to the cited page is repeated once it is.
  const openedAtPageRef = useRef(false);
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
    openedAtPageRef.current = false;
  }, [source.signedUrl, source.pageNumber]);

  useEffect(() => {
    setPageDraft(String(currentPage));
    activeThumbnailRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentPage]);

  // Track the viewer's size so the page is re-fitted when the dialog resizes.
  // A callback ref, because the viewer only mounts once the document has
  // loaded: an effect on mount would find no element and never measure.
  const viewerRef = useCallback((element: HTMLDivElement | null) => {
    viewerObserverRef.current?.disconnect();
    viewerObserverRef.current = null;
    scrollerRef.current = element;
    if (!element) {
      return;
    }
    const measure = () => setViewer({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    viewerObserverRef.current = observer;
  }, []);

  useEffect(() => () => viewerObserverRef.current?.disconnect(), []);

  const pageWidth = fitPageWidth(viewer, aspectRatio);

  const scrollToPage = useCallback((page: number) => {
    anchorsRef.current.get(page)?.scrollIntoView?.({ block: 'start' });
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      const page = Math.max(1, Math.min(numPages ?? next, next));
      setCurrentPage(page);
      scrollToPage(page);
    },
    [numPages, scrollToPage],
  );

  // Open at the cited page once the pages exist, and again once their real
  // height is known.
  useEffect(() => {
    if (numPages === null || openedAtPageRef.current) {
      return;
    }
    scrollToPage(currentPage);
    if (aspectRatio !== null) {
      openedAtPageRef.current = true;
    }
  }, [numPages, aspectRatio, currentPage, scrollToPage]);

  const followScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const line = scroller.scrollTop + scroller.clientHeight * CURRENT_PAGE_LINE;
    let page = 1;
    for (const [number, anchor] of anchorsRef.current) {
      if (anchor.offsetTop <= line && number > page) page = number;
    }
    setCurrentPage(page);
  }, []);

  // Applies the typed page number: out-of-range numbers are clamped, anything
  // that isn't a number puts the current page back.
  const commitPageDraft = useCallback(() => {
    const requested = Number.parseInt(pageDraft, 10);
    if (Number.isNaN(requested)) {
      setPageDraft(String(currentPage));
      return;
    }
    const clamped = Math.max(1, Math.min(numPages ?? requested, requested));
    goToPage(clamped);
    setPageDraft(String(clamped));
  }, [pageDraft, currentPage, numPages, goToPage]);

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
        <div
          ref={viewerRef}
          data-testid="pdf-scroll"
          onScroll={followScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="flex flex-col items-center gap-4 p-4">
            {pages.map((page) => (
              <div
                key={page}
                data-page-anchor={page}
                ref={(element) => {
                  if (element) anchorsRef.current.set(page, element);
                  else anchorsRef.current.delete(page);
                }}
                className="flex scroll-mt-4 justify-center"
                style={{ minHeight: aspectRatio ? Math.round(pageWidth / aspectRatio) : viewer.height - PAGE_PADDING }}
              >
                {Math.abs(page - currentPage) <= RENDER_WINDOW ? (
                  <Page
                    pageNumber={page}
                    width={pageWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onLoadSuccess={(loaded) => setAspectRatio((current) => current ?? loaded.originalWidth / loaded.originalHeight)}
                    className="overflow-hidden rounded-md border border-border bg-background shadow-sm"
                    loading={<div className="text-sm text-muted-foreground">Loading page…</div>}
                    error={
                      <div className="text-center text-sm text-destructive">
                        Unable to load this page. It may have expired or been removed.
                      </div>
                    }
                  />
                ) : null}
              </div>
            ))}
          </div>
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
