import { CheckCircle2, AlertCircle } from 'lucide-react';

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
  uploading: 'Uploading your file...',
  parsing: 'Processing the material...',
  embedding: 'Synthesizing key details...',
  done: 'Ready',
  error: 'Could not process this file',
};

function CircularProgress({ value }: { value: number }) {
  const size = 32;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/40"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="text-primary transition-all duration-300"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90 origin-center fill-foreground text-[9px] font-medium"
      >
        {Math.round(value)}
      </text>
    </svg>
  );
}

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
              <CircularProgress value={upload.progress} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {upload.fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              {upload.error || upload.statusText || STAGE_LABELS[upload.stage]}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
