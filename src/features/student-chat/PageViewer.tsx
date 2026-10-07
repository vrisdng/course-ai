import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

import { HighlightedPageImage } from './HighlightedPageImage';
import { type ActiveViewerSource, ensureStartingPage } from './documentViewer';

const workerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PageViewerProps {
  source: ActiveViewerSource;
}

const PAGE_WIDTH = 720;

export function PageViewer({ source }: PageViewerProps) {
  const [loaded, setLoaded] = useState(false);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const pageNumber = ensureStartingPage(source.pageNumber);
  const pageImage = source.kind === 'pdf' ? source.pageImage : null;
  const file = useMemo(
    () => (source.signedUrl ? { url: source.signedUrl } : false),
    [source.signedUrl],
  );

  // Tall pages would otherwise open at the top with the cited passage off-screen.
  useEffect(() => {
    highlightRef.current?.scrollIntoView?.({ block: 'center' });
  }, [pageImage?.url, source.highlightBox]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex h-full max-w-full flex-col items-center justify-center">
          {source.kind === 'image' && source.signedUrl ? (
            <img
              src={source.signedUrl}
              alt={source.documentName}
              className="max-h-[80vh] w-auto rounded-md object-contain shadow-sm"
            />
          ) : pageImage ? (
            <HighlightedPageImage
              ref={highlightRef}
              image={pageImage}
              alt={`${source.documentName}, page ${pageNumber}`}
              highlightBox={source.highlightBox}
              className="w-full max-w-[840px] overflow-hidden rounded-md shadow-sm"
            />
          ) : source.kind === 'pdf' ? (
            <div className="w-full max-w-[840px]">
              <Document
                file={file}
                loading={<div className="py-16 text-center text-sm text-muted-foreground">Loading document…</div>}
              >
                <Page
                  pageNumber={pageNumber}
                  width={PAGE_WIDTH}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={<div className="py-16 text-center text-sm text-muted-foreground">Loading page…</div>}
                  onSuccess={() => setLoaded(true)}
                  error={
                    <div className="py-16 text-center text-sm text-destructive">
                      Unable to load this page. It may have expired or been removed.
                    </div>
                  }
                />
              </Document>
            </div>
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">No preview available for this file.</div>
          )}
        </div>
      </div>

      {!loaded && source.kind === 'pdf' && !pageImage ? (
        <div className="border-t border-border bg-muted/30 py-2 text-center text-xs text-muted-foreground">
          Loading page…
        </div>
      ) : null}

      <div className="shrink-0 border-t border-border bg-muted/20 px-5 py-2">
        <p
          data-testid="page-viewer-path"
          className="truncate text-center text-[11px] font-medium text-muted-foreground"
          title={source.documentName}
        >
          {source.documentName}
          {source.kind === 'pdf' ? ` · Page ${pageNumber}` : ''}
        </p>
      </div>
    </div>
  );
}
