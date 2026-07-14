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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Material } from '@/features/materials/types';

interface EditFileNameDialogProps {
  material: Material | null;
  value: string;
  isSaving: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function EditFileNameDialog({
  material,
  value,
  isSaving,
  onValueChange,
  onClose,
  onSave,
}: EditFileNameDialogProps) {
  return (
    <Dialog open={Boolean(material)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Filename</DialogTitle>
          <DialogDescription>
            Update the display name used for this material in the dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="edit-material-filename">Filename</Label>
          <Input
            id="edit-material-filename"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            disabled={isSaving}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSave();
              }
            }}
          />
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
              'Save Filename'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
