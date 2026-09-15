import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

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
  const pageNumber = ensureStartingPage(source.pageNumber);
  const file = useMemo(
    () => (source.signedUrl ? { url: source.signedUrl } : false),
    [source.signedUrl],
  );

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

      {!loaded && source.kind === 'pdf' ? (
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
