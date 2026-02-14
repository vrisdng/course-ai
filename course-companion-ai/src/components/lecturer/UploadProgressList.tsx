import { Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface UploadProgress {
  fileName: string;
  stage: 'uploading' | 'parsing' | 'embedding' | 'done' | 'error';
  progress: number;
  error?: string;
  statusText?: string;
}

interface UploadProgressListProps {
  uploads: Map<string, UploadProgress>;
}

const STAGE_LABELS: Record<string, string> = {
  uploading: 'Collecting your file...',
  parsing: 'Processing the material...',
  embedding: 'Synthesizing key details...',
  done: 'Ready',
  error: 'Could not process this file',
};

export function UploadProgressList({ uploads }: UploadProgressListProps) {
  if (uploads.size === 0) return null;

  return (
    <div className="space-y-3">
      {Array.from(uploads.entries()).map(([id, upload]) => (
        <div
          key={id}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center">
            {upload.stage === 'done' ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : upload.stage === 'error' ? (
              <AlertCircle className="h-5 w-5 text-destructive" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {upload.fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              {upload.error || upload.statusText || STAGE_LABELS[upload.stage]}
            </p>
            {upload.stage !== 'done' && upload.stage !== 'error' && (
              <Progress value={upload.progress} className="mt-1 h-1.5" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
