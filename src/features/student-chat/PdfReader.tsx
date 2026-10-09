import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ensureStartingPage, type ActiveViewerSource } from './documentViewer';
import { findMatches, highlightMatches } from './pdfSearch';

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

// The parts of pdf.js's loaded document that search reads.
interface SearchablePdf {
  numPages: number;
  getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
}

// Each page's text-layer items, in the same order react-pdf renders them, so
// a match's item index lines up with customTextRenderer's itemIndex.
async function readPageItems(pdf: SearchablePdf): Promise<string[][]> {
  const pages: string[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    pages.push(
      content.items.map((item) => (typeof item === 'object' && item !== null && 'str' in item ? String(item.str) : '')),
    );
  }
  return pages;
}

const MIN_SEARCH_LENGTH = 2;

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
// for jumping to any page, plus text search over the loaded PDF with matches
// highlighted. All pages come from one loaded document.
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

  const pdfRef = useRef<SearchablePdf | null>(null);
  const [query, setQuery] = useState('');
  const [pageTexts, setPageTexts] = useState<string[][] | null>(null);
  const [activeMatch, setActiveMatch] = useState(0);

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
    pdfRef.current = null;
    setPageTexts(null);
    setQuery('');
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

  const searchActive = query.trim().length >= MIN_SEARCH_LENGTH;

  // Page text is read from the loaded PDF the first time someone searches.
  useEffect(() => {
    const pdf = pdfRef.current;
    if (!searchActive || pageTexts !== null || !pdf) {
      return;
    }
    let cancelled = false;
    void readPageItems(pdf)
      .then((texts) => {
        if (!cancelled) setPageTexts(texts);
      })
      .catch(() => {
        if (!cancelled) setPageTexts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [searchActive, pageTexts, numPages]);

  const matches = useMemo(() => findMatches(pageTexts ?? [], query), [pageTexts, query]);

  useEffect(() => setActiveMatch(0), [query]);

  // Bring the active match's page into view.
  const matchPage = matches[activeMatch]?.page;
  useEffect(() => {
    if (matchPage !== undefined) goToPage(matchPage);
  }, [matchPage, activeMatch, goToPage]);

  const stepMatch = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      setActiveMatch((current) => (current + delta + matches.length) % matches.length);
    },
    [matches.length],
  );

  // The current match is filled; every other match is outlined.
  const currentMatch = matches[activeMatch];
  const renderHighlightedText = useCallback(
    ({ str, pageNumber, itemIndex }: { str: string; pageNumber: number; itemIndex: number }) =>
      highlightMatches(
        str,
        query,
        currentMatch && currentMatch.page === pageNumber && currentMatch.item === itemIndex ? currentMatch.occurrence : null,
      ),
    [query, currentMatch],
  );

  let searchStatus = '';
  if (searchActive) {
    if (pageTexts === null) searchStatus = 'Searching…';
    else if (matches.length === 0) searchStatus = 'No matches';
    else searchStatus = `${activeMatch + 1} of ${matches.length}`;
  }

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
      onLoadSuccess={(pdf: SearchablePdf) => {
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
      }}
      loading={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading document…</div>}
      className="flex h-full min-h-0 bg-muted/20"
    >
      <nav
        aria-label="Pages"
        className="hidden w-40 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted/40 px-4 py-4 sm:flex"
      >
        {pages.map((page) => {
          const isCurrent = page === currentPage;
          return (
            <button
              key={page}
              type="button"
              ref={isCurrent ? activeThumbnailRef : undefined}
              onClick={() => goToPage(page)}
              aria-label={`Page ${page}`}
              aria-pressed={isCurrent}
              className="group flex shrink-0 flex-col items-center gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Page
                pageNumber={page}
                width={THUMBNAIL_WIDTH}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className={cn(
                  'overflow-hidden rounded-sm bg-background transition-shadow',
                  isCurrent
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-muted'
                    : 'border border-border opacity-80 group-hover:opacity-100',
                )}
                loading={<div className="h-36 w-28 rounded-sm bg-background" />}
              />
              <span className={cn('text-xs tabular-nums', isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {page}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background py-2.5 pl-4 pr-14">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={source.documentName}>
            {source.documentName}
          </p>

          <div className="flex h-8 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/30">
            <Search aria-hidden="true" className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="search"
              aria-label="Search document"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  stepMatch(event.shiftKey ? -1 : 1);
                }
              }}
              className="h-full w-40 bg-transparent px-2 text-sm outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {searchStatus ? (
              <span aria-live="polite" className="whitespace-nowrap pr-1 text-xs tabular-nums text-muted-foreground">
                {searchStatus}
              </span>
            ) : null}
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Previous match" onClick={() => stepMatch(-1)} disabled={matches.length === 0}>
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="mr-0.5 h-7 w-7" aria-label="Next match" onClick={() => stepMatch(1)} disabled={matches.length === 0}>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex h-8 items-center rounded-md border border-input bg-background">
            <Button
              size="icon"
              variant="ghost"
              className="ml-0.5 h-7 w-7"
              aria-label="Previous page"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
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
              className="h-6 w-9 rounded-sm bg-transparent text-center text-sm tabular-nums outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus:bg-muted [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="pr-1 text-sm tabular-nums text-muted-foreground">{numPages !== null ? `/ ${numPages}` : ''}</span>
            <Button
              size="icon"
              variant="ghost"
              className="mr-0.5 h-7 w-7"
              aria-label="Next page"
              onClick={() => goToPage(currentPage + 1)}
              disabled={numPages !== null && currentPage >= numPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

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
                    renderTextLayer={searchActive}
                    customTextRenderer={searchActive ? renderHighlightedText : undefined}
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
      </div>
    </Document>
  );
}
