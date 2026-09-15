import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type ActiveViewerSource, ensureStartingPage } from './documentViewer';

const workerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  source: ActiveViewerSource;
  onClose: () => void;
}

const MIN_PAGE_WIDTH = 280;
const MAX_PAGE_WIDTH = 640;
const DEFAULT_PAGE_WIDTH = 560;

export function PdfViewer({ source, onClose }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(() => ensureStartingPage(source.pageNumber));
  const [pageWidth, setPageWidth] = useState(DEFAULT_PAGE_WIDTH);

  const file = useMemo(() => (source.signedUrl ? { url: source.signedUrl } : false), [source.signedUrl]);

  // Reset to the cited page whenever the source (re)opens.
  useEffect(() => {
    setPageNumber(ensureStartingPage(source.pageNumber));
  }, [source.pageNumber]);

  // Size the page to the available dialog width so long PDFs stay readable.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      const available = element.clientWidth - 24;
      setPageWidth(Math.max(MIN_PAGE_WIDTH, Math.min(available, MAX_PAGE_WIDTH)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const goToPage = (next: number) => {
    if (numPages === null) {
      setPageNumber(next);
      return;
    }
    setPageNumber(Math.max(1, Math.min(numPages, next)));
  };

  return (
    <div ref={containerRef} className="flex w-full h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="shrink-0 text-xs font-semibold text-primary">
          Page {pageNumber}
          {numPages !== null ? ` / ${numPages}` : ''}
        </span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Previous page" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Next page"
            onClick={() => goToPage(pageNumber + 1)}
            disabled={numPages !== null && pageNumber >= numPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto bg-muted/30 p-4">
        <div className="flex justify-center">
          {file ? (
            /* Whole-page highlight: a yellow ring/border around the page canvas. */
            <div
              data-testid="pdf-highlight"
              className="w-full max-w-[640px] rounded-md border-2 border-yellow-400 bg-yellow-50/50 p-2 shadow-sm ring-4 ring-yellow-300/60"
            >
              <Document
                file={file}
                onLoadSuccess={({ numPages: total }) => setNumPages(total)}
                loading={<div className="py-16 text-sm text-muted-foreground">Loading document…</div>}
              >
                <Page
                  pageNumber={pageNumber}
                  width={pageWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={<div className="py-16 text-sm text-muted-foreground">Loading page…</div>}
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

      {source.excerpt ? (
        <div className="border-t border-border bg-yellow-100/60 px-4 py-2 text-sm text-foreground/80">
          <span className="mb-1 block text-xs font-medium text-primary">Cited passage</span>
          <span className="line-clamp-3">“{source.excerpt}”</span>
        </div>
      ) : null}
    </div>
  );
}
