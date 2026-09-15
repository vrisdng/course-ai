import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Info, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { PdfReader } from './PdfReader';
import { PdfThumbnail } from './PdfThumbnail';
import { PageViewer } from './PageViewer';
import { type ActiveViewerSource, ensureStartingPage } from './documentViewer';

interface SourcesPanelProps {
  showSidePanel: boolean;
  activeViewerSource: ActiveViewerSource | null;
  openingCitationKey?: string | null;
  onOpenPanel: () => void;
  onClosePanel: () => void;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 460;

export function SourcesPanel({
  showSidePanel,
  activeViewerSource,
  openingCitationKey,
  onOpenPanel,
  onClosePanel,
}: SourcesPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [singleOpen, setSingleOpen] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: 0, active: false });

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width, active: true };
    setDragging(true);
  }, [width]);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onPointerMove = (event: MouseEvent) => {
      if (!dragRef.current.active) {
        return;
      }

      const next = dragRef.current.startWidth - (event.clientX - dragRef.current.startX);
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next)));
    };
    const onPointerUp = () => {
      dragRef.current.active = false;
      setDragging(false);
    };

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    return () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
    };
  }, [dragging]);

  const isPdf = activeViewerSource?.kind === 'pdf';
  const page = ensureStartingPage(activeViewerSource?.pageNumber);

  return (
    <>
      <aside
        style={{ width: showSidePanel ? width : 0 }}
        className={cn(
          'relative h-full shrink-0 border-l border-border bg-muted/30 overflow-hidden',
          dragging ? 'transition-none' : 'transition-[width] duration-150',
        )}
      >
        {showSidePanel && (
          <>
            <div
              onMouseDown={startResize}
              className="absolute left-0 top-0 z-20 h-full w-1.5 cursor-ew-resize hover:bg-border/60"
              role="slider"
              aria-label="Resize sources panel"
              aria-valuemin={MIN_WIDTH}
              aria-valuemax={MAX_WIDTH}
              aria-valuenow={width}
            />
            <div className="flex h-full flex-col pl-2">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-2">
                <h3 className="flex items-center gap-2 font-semibold text-foreground">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  Sources
                </h3>
                <div className="flex items-center gap-1">
                  {isPdf && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGalleryOpen(true)}
                      aria-label="View document"
                    >
                      View document
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={onClosePanel} aria-label="Close sources">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

               {activeViewerSource ? (
                 <div className="min-h-0 flex-1 overflow-y-auto p-3">
                   <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                     <div className="flex items-center gap-2 min-w-0">
                       <FileText className="h-4 w-4 shrink-0 text-primary" />
                       <span
                         className="truncate text-sm font-medium text-foreground"
                         title={`${activeViewerSource.documentName} - ${page}`}
                       >
                         {activeViewerSource.documentName} - {page}
                       </span>
                     </div>
                   </div>

                   {openingCitationKey ? (
                     <div className="mt-3 flex flex-col items-center justify-center py-8">
                       <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                       <span className="mt-2 text-sm font-medium text-muted-foreground">Loading source</span>
                     </div>
                   ) : activeViewerSource.signedUrl ? (
                     <div className="mt-3 flex justify-center">
                       <PdfThumbnail
                         source={activeViewerSource}
                         pageNumber={page}
                         width={280}
                         preview
                         onClick={() => setSingleOpen(true)}
                       />
                     </div>
                   ) : null}

                   {activeViewerSource.excerpt ? (
                     <div className="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                       <span className="mb-1 block text-xs font-semibold text-primary">Cited passage</span>
                       <p className="text-sm leading-relaxed text-foreground/80 line-clamp-6">
                         “{activeViewerSource.excerpt}”
                       </p>
                     </div>
                   ) : null}
                 </div>
               ) : (
                <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                  <Info className="mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Select a citation to see the source</p>
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      {!showSidePanel && (
        <button
          onClick={onOpenPanel}
          className="fixed right-0 top-1/2 -translate-y-1/2 rounded-l-lg border border-r-0 border-border bg-background p-2 shadow-md"
          aria-label="Open sources"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
        <DialogContent className="flex h-[92vh] max-w-5xl overflow-hidden flex-col p-0">
          <DialogTitle className="sr-only">View document</DialogTitle>
          <DialogDescription className="sr-only">Browse the pages of the cited document</DialogDescription>
          {isPdf && activeViewerSource ? (
            <PdfReader source={activeViewerSource} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={singleOpen} onOpenChange={setSingleOpen}>
        <DialogContent className="h-[90vh] max-w-3xl overflow-hidden p-0">
          <DialogTitle className="sr-only">{activeViewerSource?.documentName ?? 'Document page'}</DialogTitle>
          <DialogDescription className="sr-only">The cited page of the document</DialogDescription>
          {activeViewerSource ? <PageViewer source={activeViewerSource} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
