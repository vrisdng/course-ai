import { Download, ExternalLink, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type ActiveViewerSource } from './documentViewer';

interface OtherViewerProps {
  source: ActiveViewerSource;
  onClose: () => void;
}

function fileExtension(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE';
}

export function OtherViewer({ source, onClose }: OtherViewerProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted/50">
        <FileText className="h-7 w-7 text-muted-foreground/60" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{source.documentName}</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {fileExtension(source.documentName)} files can’t be previewed in the chat. Open it in a new tab or download it to view.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {source.signedUrl ? (
          <Button asChild variant="default">
            <a href={source.signedUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open in new tab
            </a>
          </Button>
        ) : null}
        {source.signedUrl ? (
          <Button asChild variant="outline">
            <a href={source.signedUrl} download={source.documentName}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
