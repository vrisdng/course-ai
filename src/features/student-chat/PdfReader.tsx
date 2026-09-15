import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { PdfThumbnail } from './PdfThumbnail';
import { ensureStartingPage, type ActiveViewerSource } from './documentViewer';

const workerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfReaderProps {
  source: ActiveViewerSource;
}

const MIN_PAGE_WIDTH = 280;
const MAX_PAGE_WIDTH = 840;
const DEFAULT_PAGE_WIDTH = 600;
const THUMB_WIDTH = 116;
const SLICE_SIZE = 7;
const SLICE_GAP = 12;
// Scale the top page down so it fits fully with visible margins instead of stretching
// edge-to-edge and getting cut off. The flex layout keeps responding to any screen size.
const PAGE_SCALE = 0.6;

export function PdfReader({ source }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(() => ensureStartingPage(source.pageNumber));
  const [pageWidth, setPageWidth] = useState(DEFAULT_PAGE_WIDTH);
  const [sliceThumbWidth, setSliceThumbWidth] = useState(THUMB_WIDTH);

  const file = useMemo(
    () => (source.signedUrl ? { url: source.signedUrl } : false),
    [source.signedUrl],
  );

  // Reset whenever the source (or its page) changes so stale pages/scroll don't linger.
  useEffect(() => {
    setNumPages(null);
    setCurrentPage(ensureStartingPage(source.pageNumber));
  }, [source.signedUrl, source.pageNumber]);

  // Size the big page width to the panel so long PDFs stay readable.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const available = (element.clientWidth - 32) * PAGE_SCALE;
      setPageWidth(Math.max(MIN_PAGE_WIDTH, Math.min(available, MAX_PAGE_WIDTH)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Scale the page down to fit the available height. The page canvas only exists
  // after react-pdf renders it, so this runs from the Page onSuccess callback
  // (and re-runs whenever the width/page changes) instead of from a mount effect
  // that would miss the canvas and leave the page oversized on first load.
  const fitToHeight = useCallback(() => {
    const container = containerRef.current;
    const canvas = container?.querySelector<HTMLCanvasElement>('canvas');
    if (!container || !canvas || !canvas.clientHeight || pageWidth <= MIN_PAGE_WIDTH) {
      return;
    }
    const available = (container.clientHeight - 32) * PAGE_SCALE;
    if (canvas.clientHeight <= available) {
      return;
    }
    const scale = available / canvas.clientHeight;
    setPageWidth((width) => Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, width * scale)));
  }, [pageWidth]);

  // Size each thumbnail so a full slice (SLICE_SIZE pages) fits across the panel.
  // The row is measured directly so its own horizontal padding is included and the
  // thumbnails fill it exactly (no scroll); slices with fewer pages are then centered.
  useEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const inner = element.clientWidth;
      const width = Math.floor((inner - (SLICE_SIZE - 1) * SLICE_GAP) / SLICE_SIZE);
      setSliceThumbWidth(Math.max(80, Math.min(width, THUMB_WIDTH)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      if (numPages === null) {
        setCurrentPage(next);
        return;
      }
      setCurrentPage(Math.max(1, Math.min(numPages, next)));
    },
    [numPages],
  );

  const goPrevPage = useCallback(() => goToPage(currentPage - 1), [goToPage, currentPage]);
  const goNextPage = useCallback(() => goToPage(currentPage + 1), [goToPage, currentPage]);

  const sliceIndex = numPages === null ? 0 : Math.floor((currentPage - 1) / SLICE_SIZE);
  const numSlices = numPages === null ? 0 : Math.ceil(numPages / SLICE_SIZE);
  const sliceStart = sliceIndex * SLICE_SIZE + 1;
  const sliceEnd = numPages === null ? sliceStart : Math.min(sliceStart + SLICE_SIZE - 1, numPages);
  const slicePages = useMemo(
    () => Array.from({ length: sliceEnd - sliceStart + 1 }, (_, index) => sliceStart + index),
    [sliceStart, sliceEnd],
  );

  // Slice navigation jumps the big page to the first page of the target slice so
  // the highlighted thumbnail stays visible.
  const goPrevSlice = useCallback(() => {
    if (sliceIndex > 0) {
      setCurrentPage((sliceIndex - 1) * SLICE_SIZE + 1);
    }
  }, [sliceIndex]);
  const goNextSlice = useCallback(() => {
    if (sliceIndex < numSlices - 1) {
      setCurrentPage((sliceIndex + 1) * SLICE_SIZE + 1);
    }
  }, [sliceIndex, numSlices]);

  const prevSliceDisabled = sliceIndex <= 0;
  const nextSliceDisabled = numSlices <= 1 || sliceIndex >= numSlices - 1;

  return (
    <div className="flex h-full flex-col bg-muted/20">
      {/* Top: page view (navigation moved to the bottom) */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto">
          <div className="flex h-full min-h-0 items-center justify-center bg-muted/30 p-4">
            {file ? (
              <div
                data-testid="pdf-highlight"
                className="max-w-[840px] rounded-md border border-border bg-background shadow-sm"
              >
                <Document
                  file={file}
                  onLoadSuccess={({ numPages: total }) => setNumPages(total)}
                  loading={<div className="py-16 text-sm text-muted-foreground">Loading document…</div>}
                >
                  <Page
                    pageNumber={currentPage}
                    width={pageWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    loading={<div className="py-16 text-sm text-muted-foreground">Loading page…</div>}
                    onSuccess={fitToHeight}
                    error={
                      <div className="py-16 text-center text-sm text-destructive">
                        Unable to load this page. It may have expired or been removed.
                      </div>
                    }
                  />
                </Document>
              </div>
            ) : (
              <div className="py-16 text-sm text-muted-foreground">No document available to preview.</div>
            )}
          </div>
        </div>
      </div>

      {/* Divider between the page view and the thumbnail slices */}
      <div className="h-1.5 w-full border-t border-border bg-muted/40" />

      {/* Bottom: page navigation + slice navigation + thumbnails */}
      <div className="shrink-0 border-t border-border bg-muted/30 flex flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              aria-label="Previous page"
              onClick={goPrevPage}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label="Next page"
              onClick={goNextPage}
              disabled={numPages !== null && currentPage >= numPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-1 min-w-[4.5rem] text-center text-xs font-semibold text-primary">
              Page {currentPage}
              {numPages !== null ? ` / ${numPages}` : ''}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="mr-1 min-w-[3.5rem] text-center text-xs font-semibold text-primary">
              Slice {sliceIndex + 1}
              {numSlices > 0 ? ` / ${numSlices}` : ''}
            </span>
            <Button
              size="icon"
              variant="outline"
              aria-label="Previous slice"
              onClick={goPrevSlice}
              disabled={prevSliceDisabled}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label="Next slice"
              onClick={goNextSlice}
              disabled={nextSliceDisabled}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div ref={rowRef} className="flex gap-3 px-3 justify-center">
            {numPages === null ? (
              <div className="flex items-center text-xs text-muted-foreground">Loading document…</div>
            ) : (
              slicePages.map((page) => (
                <div key={page} style={{ flex: `0 0 ${sliceThumbWidth}px` }}>
                  <PdfThumbnail
                    source={source}
                    pageNumber={page}
                    width={sliceThumbWidth}
                    highlighted={page === currentPage}
                    onClick={() => goToPage(page)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
