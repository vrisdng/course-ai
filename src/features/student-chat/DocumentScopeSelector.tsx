import { ChevronDown, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import {
  type ChatDocumentOption,
  getDocumentSelectorLabel,
} from './documentScope';

interface DocumentScopeSelectorProps {
  documents: ChatDocumentOption[];
  selectedDocumentIds: string[];
  isLoading: boolean;
  disabled?: boolean;
  buttonClassName?: string;
  onSelectAllDocuments: () => void;
  onClearSelection: () => void;
  onApplySelection: (documentIds: string[]) => void;
}

export function DocumentScopeSelector({
  documents,
  selectedDocumentIds,
  isLoading,
  disabled = false,
  buttonClassName,
  onSelectAllDocuments,
  onClearSelection,
  onApplySelection,
}: DocumentScopeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [draftSelectedDocumentIds, setDraftSelectedDocumentIds] = useState<string[]>(selectedDocumentIds);
  const label = getDocumentSelectorLabel(documents, selectedDocumentIds, isLoading);
  const isDisabled = disabled || isLoading || documents.length === 0;
  const allSelected = documents.length > 0 && draftSelectedDocumentIds.length === documents.length;

  useEffect(() => {
    if (!open) {
      setDraftSelectedDocumentIds(selectedDocumentIds);
    }
  }, [open, selectedDocumentIds]);

  const handleToggleDocument = (documentId: string) => {
    setDraftSelectedDocumentIds((current) => (
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    ));
  };

  const handleSelectAll = () => {
    setDraftSelectedDocumentIds(documents.map((document) => document.id));
  };

  const handleDeselectAll = () => {
    setDraftSelectedDocumentIds([]);
  };

  const handleCancel = () => {
    setDraftSelectedDocumentIds(selectedDocumentIds);
    setOpen(false);
  };

  const handleApply = () => {
    if (allSelected) {
      onSelectAllDocuments();
    } else if (draftSelectedDocumentIds.length === 0) {
      onClearSelection();
    } else {
      onApplySelection(draftSelectedDocumentIds);
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn('w-full justify-between gap-3 px-3 text-left font-normal', buttonClassName)}
          disabled={isDisabled}
        >
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select Documents</DialogTitle>
          <DialogDescription>
            Choose the course materials the chat should focus on. Selecting no documents will answer from general knowledge without using any uploaded materials.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {allSelected
              ? 'Using all course documents'
              : draftSelectedDocumentIds.length === 0
                ? 'No documents selected.'
                : `${draftSelectedDocumentIds.length} material${draftSelectedDocumentIds.length === 1 ? '' : 's'} selected`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              disabled={documents.length === 0}
            >
              Select All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDeselectAll}
              disabled={draftSelectedDocumentIds.length === 0}
            >
              Deselect All
            </Button>
          </div>
        </div>

        <ScrollArea className="max-h-[50vh] rounded-md border">
          <div className="space-y-2 p-3">
            {documents.map((document) => {
              const isChecked = draftSelectedDocumentIds.includes(document.id);

              return (
                <div
                  key={document.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleToggleDocument(document.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleToggleDocument(document.id);
                    }
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
                    isChecked ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40'
                  )}
                >
                  <Checkbox
                    checked={isChecked}
                    className="mt-0.5"
                    aria-label={`Select ${document.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{document.name}</p>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {document.type}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
