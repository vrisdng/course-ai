import { Copy, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Course } from '@/features/materials/types';

interface EnrollmentCodeDialogProps {
  course: Course | null;
  code: string | null;
  expiresAt: string | null;
  isLoading: boolean;
  isGenerating: boolean;
  onClose: () => void;
  onCopyCode: (code: string) => void;
  onGenerateCode: () => void;
}

export function EnrollmentCodeDialog({
  course,
  code,
  expiresAt,
  isLoading,
  isGenerating,
  onClose,
  onCopyCode,
  onGenerateCode,
}: EnrollmentCodeDialogProps) {
  return (
    <Dialog open={Boolean(course)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enrollment Code</DialogTitle>
          <DialogDescription>
            {course
              ? `Share this code with students to let them self-enroll in ${course.name}${course.code ? ` (${course.code})` : ''}.`
              : 'Share this code with students so they can self-enroll.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : code ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                <p className="mb-1 text-xs text-muted-foreground">Course enrollment code</p>
                <p className="font-mono text-3xl font-bold tracking-widest text-primary">{code}</p>
                {expiresAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Expires {new Date(expiresAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={() => onCopyCode(code)}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Code
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Students enter this code on the chat page to enroll in this course.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No enrollment code exists for this course yet. Generate one to share with your students.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {code ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onGenerateCode}
              disabled={isGenerating || isLoading}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate Code
                </>
              )}
            </Button>
          ) : (
            <Button type="button" onClick={onGenerateCode} disabled={isGenerating || isLoading}>
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate Code'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
