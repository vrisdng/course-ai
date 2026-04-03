import { ReactNode, useEffect, useRef } from 'react';
import { Send, Square } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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
  documentScopeSummary?: string;
  documentHint?: string | null;
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
  documentScopeSummary,
  documentHint,
}: ChatComposerProps) {
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
        {documentSelector || documentScopeSummary || documentHint ? (
          <div className="flex flex-wrap items-center gap-2">
            {documentSelector}
            {documentScopeSummary ? (
              <Badge variant="secondary" className="max-w-full truncate px-2 py-1 font-medium">
                {documentScopeSummary}
              </Badge>
            ) : null}
            {documentHint ? (
              <span className="text-xs text-muted-foreground">{documentHint}</span>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="min-h-[44px] max-h-[200px] resize-none"
            rows={1}
            disabled={isLoading || disabled}
          />

          <Button
            onClick={isLoading ? onStop : onSend}
            disabled={(!isLoading && !input.trim()) || disabled}
            size={isLoading ? 'default' : 'icon'}
            variant={isLoading ? 'outline' : 'default'}
            className={cn(
              'h-[44px] shrink-0',
              isLoading ? 'gap-2 px-4' : 'w-[44px]'
            )}
          >
            {isLoading ? (
              <>
                <Square className="h-4 w-4 fill-current" />
                <span>Stop</span>
              </>
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {footerText}
        </p>
      </div>
    </div>
  );
}
