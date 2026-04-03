import { ChevronDown, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  onToggleDocument: (documentId: string) => void;
  onClearSelection: () => void;
}

export function DocumentScopeSelector({
  documents,
  selectedDocumentIds,
  isLoading,
  disabled = false,
  buttonClassName,
  onToggleDocument,
  onClearSelection,
}: DocumentScopeSelectorProps) {
  const label = getDocumentSelectorLabel(documents, selectedDocumentIds, isLoading);
  const isDisabled = disabled || isLoading || documents.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Select document scope</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={selectedDocumentIds.length === 0}
          onCheckedChange={() => onClearSelection()}
        >
          All course documents
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {documents.map((document) => (
          <DropdownMenuCheckboxItem
            key={document.id}
            checked={selectedDocumentIds.includes(document.id)}
            onCheckedChange={() => onToggleDocument(document.id)}
          >
            <span className="truncate">{document.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
