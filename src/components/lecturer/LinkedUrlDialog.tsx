import { ExternalLink, Link, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Material } from '@/pages/AdminDashboard';

interface LinkedUrlDialogProps {
  material: Material | null;
  value: string;
  isSaving: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function LinkedUrlDialog({
  material,
  value,
  isSaving,
  onValueChange,
  onClose,
  onSave,
}: LinkedUrlDialogProps) {
  return (
    <Dialog open={Boolean(material)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attached URL</DialogTitle>
          <DialogDescription>
            {material
              ? `View or edit the URL attached to "${material.file_name}".`
              : 'View or edit the URL attached to this video.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="linked-url">URL</Label>
          <Input
            id="linked-url"
            type="url"
            placeholder="https://example.com/video"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={isSaving}
          />
          {value.trim() && (
            <a
              href={value.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open URL in new tab
            </a>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Link className="mr-2 h-4 w-4" />
                Save URL
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
