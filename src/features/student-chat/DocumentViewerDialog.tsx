import { FileText } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

import { ImageViewer } from './ImageViewer';
import { OtherViewer } from './OtherViewer';
import { PdfViewer } from './PdfViewer';
import { type ActiveViewerSource } from './documentViewer';

interface DocumentViewerProps {
  source: ActiveViewerSource | null;
  onClose: () => void;
}

function viewerLabel(source: ActiveViewerSource): string {
  if (source.kind === 'image') return 'Image';
  if (source.kind === 'other') {
    const parts = source.documentName.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'File';
  }
  return 'PDF';
}

export function DocumentViewerDialog({ source, onClose }: DocumentViewerProps) {
  if (!source) return null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex w-full max-w-4xl flex-col rounded-xl p-0">
        <div className="flex h-[92vh] flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <DialogTitle className="flex items-center gap-2 truncate text-base font-semibold text-foreground" title={source.documentName}>
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{source.documentName}</span>
            </DialogTitle>
            <DialogDescription className="shrink-0 rounded bg-muted/60 px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
              {viewerLabel(source)}
            </DialogDescription>
          </div>

          <div className="flex min-h-0 flex-1 overflow-auto p-3">
          {source.kind === 'pdf' ? (
            <PdfViewer source={source} onClose={onClose} />
          ) : source.kind === 'image' ? (
            <ImageViewer source={source} onClose={onClose} />
          ) : (
            <OtherViewer source={source} onClose={onClose} />
          )}
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
