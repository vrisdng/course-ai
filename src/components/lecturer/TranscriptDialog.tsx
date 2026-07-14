import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { groupSegmentsIntoParagraphs } from '@/features/student-chat/groupTranscriptSegments';
import { formatTimestamp as formatClock } from '@/features/student-chat/time';
import type { Material, TranscriptSegment } from '@/features/materials/types';

interface TranscriptDialogProps {
  material: Material | null;
  segments: TranscriptSegment[];
  isLoading: boolean;
  onClose: () => void;
}

export function TranscriptDialog({ material, segments, isLoading, onClose }: TranscriptDialogProps) {
  return (
    <Dialog open={Boolean(material)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Video Transcript</DialogTitle>
          <DialogDescription>
            {material
              ? `Timestamped transcript extracted from ${material.file_name}.`
              : 'Timestamped transcript extracted from this video.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="h-[60vh] space-y-3 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading transcript...
              </div>
            ) : segments.length === 0 ? (
              <div className="rounded-md border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                No transcript segments were found for this video yet.
              </div>
            ) : (
              <div className="space-y-2">
                {groupSegmentsIntoParagraphs(segments).map((para) => (
                  <div key={para.id} className="rounded-md border border-border bg-muted/20 px-4 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-xs font-medium text-primary">
                        {formatClock(para.startMs)}–{formatClock(para.endMs)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">{para.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
