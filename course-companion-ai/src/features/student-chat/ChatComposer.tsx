import { ReactNode, useEffect, useRef } from 'react';
import { ChevronDown, Send, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { CHAT_MODEL_OPTIONS, type ChatModelTier } from './useStudentChat';

interface ChatComposerProps {
  input: string;
  isLoading: boolean;
  disabled?: boolean;
  onInputChange: (nextValue: string) => void;
  onSend: () => void;
  onStop: () => void;
  placeholder?: string;
  footerText?: string;
  documentSelector?: ReactNode;
  documentHint?: string | null;
  selectedModel: ChatModelTier;
  onModelChange: (model: ChatModelTier) => void;
}

export function ChatComposer({
  input,
  isLoading,
  disabled = false,
  onInputChange,
  onSend,
  onStop,
  placeholder = 'Ask a question about your course materials...',
  footerText = 'EduChat uses RAG to ground answers in your course materials',
  documentSelector,
  documentHint,
  selectedModel,
  onModelChange,
}: ChatComposerProps) {
  const selectedModelLabel = CHAT_MODEL_OPTIONS.find((m) => m.value === selectedModel)?.label ?? 'Fast';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;

    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
  }, [input]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="border-t border-border bg-background p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {(documentSelector || documentHint) ? (
          <div className="flex flex-wrap items-center gap-2">
            {documentSelector}
            {documentHint ? (
              <span className="text-xs text-muted-foreground">{documentHint}</span>
            ) : null}
          </div>
        ) : null}

        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="min-h-[80px] max-h-[200px] resize-none pb-8 pr-14"
            rows={1}
            disabled={isLoading || disabled}
          />
          <div className="absolute bottom-2 left-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={isLoading}
                >
                  {selectedModelLabel}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                {CHAT_MODEL_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => onModelChange(option.value)}
                    className={cn(selectedModel === option.value && 'font-medium')}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="absolute bottom-2 right-2">
            <Button
              onClick={isLoading ? onStop : onSend}
              disabled={(!isLoading && !input.trim()) || disabled}
              size={isLoading ? 'default' : 'icon'}
              variant={isLoading ? 'outline' : 'default'}
              className={cn(
                'h-8 shrink-0',
                isLoading ? 'gap-2 px-3 text-xs' : 'w-8'
              )}
            >
              {isLoading ? (
                <>
                  <Square className="h-3 w-3 fill-current" />
                  <span>Stop</span>
                </>
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {footerText}
        </p>
      </div>
    </div>
  );
}
