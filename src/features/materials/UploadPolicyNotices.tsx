// Upload-zone copy that follows the upload policy: what teachers can upload,
// and which of their files were turned away and why.
import { AlertCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  UPLOAD_POLICY,
  acceptedUploadSummary,
  type UploadPolicy,
} from '../../../supabase/functions/_shared/uploadPolicy.ts';
import type { UploadRejection } from './types';

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// One line under the drop zone prompt.
export function AcceptedUploadsHint({ policy = UPLOAD_POLICY }: { policy?: UploadPolicy }) {
  return <p className="mt-1 text-xs text-muted-foreground">{sentenceCase(acceptedUploadSummary(policy))} only</p>;
}

interface AcceptedUploadsHelpProps {
  documentLimitMb: number;
  policy?: UploadPolicy;
}

export function AcceptedUploadsHelp({ documentLimitMb, policy = UPLOAD_POLICY }: AcceptedUploadsHelpProps) {
  const acceptsOffice = policy.enabledFamilies.includes('office');
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p className="text-sm font-medium text-foreground">What can be uploaded?</p>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        <li>{sentenceCase(acceptedUploadSummary(policy))}.</li>
        <li>PDF files must be {documentLimitMb}MB or smaller.</li>
        <li>MP4 and WebM videos are stored for playback and transcribed with timestamps (limited only by the storage provider's maximum object size).</li>
        {!acceptsOffice && (
          <li>Save or export Word (DOCX) and PowerPoint (PPTX) files as PDF before uploading them.</li>
        )}
      </ul>
    </div>
  );
}

interface RejectedUploadsAlertProps {
  rejections: UploadRejection[];
  onDismiss: () => void;
}

export function RejectedUploadsAlert({ rejections, onDismiss }: RejectedUploadsAlertProps) {
  if (rejections.length === 0) {
    return null;
  }
  const count = rejections.length;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-left"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-destructive">
          {count} file{count === 1 ? ' was' : 's were'} not added
        </p>
        <ul className="mt-1 space-y-1 text-xs text-foreground">
          {rejections.map((rejection, index) => (
            <li key={`${index}-${rejection.fileName}`} className="break-words">{rejection.message}</li>
          ))}
        </ul>
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onDismiss} aria-label="Dismiss">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
