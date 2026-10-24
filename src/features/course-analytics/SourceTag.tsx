import { FileText, Video } from 'lucide-react';

import { cn } from '@/lib/utils';

interface SourceTagProps {
  label: string;
  fileType: string;
  detail?: string;
  onClick(): void;
  className?: string;
}

// A clickable tag for a cited file, page or video moment.
export function SourceTag({ label, fileType, detail, onClick, className }: SourceTagProps) {
  const Icon = fileType === 'video' ? Video : FileText;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
      {detail && (
        <>
          <span className="sr-only">, </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{detail}</span>
        </>
      )}
    </button>
  );
}
