import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

import { cn } from '@/lib/utils';

import { type ActiveViewerSource } from './documentViewer';

const workerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfThumbnailProps {
  source: ActiveViewerSource;
  pageNumber: number;
  width: number;
  onClick?: () => void;
  label?: React.ReactNode;
  highlighted?: boolean;
  // Full-bleed preview (no label row): the frame hugs the page so it fills the space instead of leaving blank margins.
  preview?: boolean;
}

export function PdfThumbnail({ source, pageNumber, width, onClick, label, highlighted, preview }: PdfThumbnailProps) {
  const [pdfjsLoaded, setPdfjsLoaded] = useState(false);
  
  // Use thumbnailUrl if available (backend-rendered thumbnail)
  const thumbnailFile = useMemo(
    () => (source.thumbnailUrl ? { url: source.thumbnailUrl } : null),
    [source.thumbnailUrl],
  );
  
  // Fallback: use signedUrl and render with pdf.js
  const pdfjsFile = useMemo(
    () => (source.signedUrl ? { url: source.signedUrl } : false),
    [source.signedUrl],
  );

  // If we have a thumbnail URL, use a simple img tag
  if (thumbnailFile) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Page ${pageNumber}`}
        aria-pressed={highlighted}
        className={cn(
          'mx-auto overflow-hidden rounded-md shadow-sm transition-all duration-200',
          preview ? 'w-auto cursor-pointer hover:-translate-y-0.5' : 'w-full',
          highlighted
            ? 'border-2 border-yellow-400 ring-2 ring-yellow-300/60'
            : 'border border-border hover:border-primary/60',
        )}
      >
        <img
          src={thumbnailFile.url}
          alt={`Page ${pageNumber}`}
          className="block"
          style={{ width: '100%', height: 'auto' }}
          loading="lazy"
        />
        
        {label !== undefined ? (
          <div
            className={cn(
              'flex items-center justify-between gap-2 px-2 py-1 text-[11px] font-medium',
              highlighted ? 'bg-yellow-50 text-primary' : 'bg-muted/40 text-muted-foreground',
            )}
          >
            <span>Page {pageNumber}</span>
            {highlighted ? <span className="rounded bg-yellow-200/70 px-1 py-0.5 text-[9px] uppercase">Cited</span> : null}
          </div>
        ) : null}
      </button>
    );
  }

   // Fallback: render with pdf.js
   return (
     <button
       type="button"
       onClick={onClick}
       aria-label={`Page ${pageNumber}`}
       aria-pressed={highlighted}
       className={cn(
         'mx-auto overflow-hidden rounded-md shadow-sm transition-all duration-200',
         preview ? 'w-auto cursor-pointer hover:-translate-y-0.5' : 'w-full',
         highlighted
           ? 'border-2 border-yellow-400 ring-2 ring-yellow-300/60'
           : 'border border-border hover:border-primary/60',
       )}
     >
       {pdfjsFile ? (
         <Document
           file={pdfjsFile}
           loading={<div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>}
         >
           <Page
             pageNumber={pageNumber}
             width={width}
             renderTextLayer={false}
             renderAnnotationLayer={false}
             loading={<div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>}
             onSuccess={() => setPdfjsLoaded(true)}
           />
         </Document>
       ) : (
         <div className="flex h-24 items-center justify-center px-2 text-center text-xs text-muted-foreground">
           Preview unavailable
         </div>
       )}

       {!pdfjsLoaded && pdfjsFile ? (
         <div className="bg-muted/40 text-[11px] font-medium text-muted-foreground">Page {pageNumber}</div>
       ) : label !== undefined ? (
         <div
           className={cn(
             'flex items-center justify-between gap-2 px-2 py-1 text-[11px] font-medium',
             highlighted ? 'bg-yellow-50 text-primary' : 'bg-muted/40 text-muted-foreground',
           )}
         >
           <span>Page {pageNumber}</span>
           {highlighted ? <span className="rounded bg-yellow-200/70 px-1 py-0.5 text-[9px] uppercase">Cited</span> : null}
         </div>
       ) : null}
     </button>
   );
 }
