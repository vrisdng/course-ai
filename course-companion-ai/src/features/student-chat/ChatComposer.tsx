import { useEffect, useRef } from 'react';
import { Send, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface ChatComposerProps {
  input: string;
  isLoading: boolean;
  onInputChange: (nextValue: string) => void;
  onSend: () => void;
  onStop: () => void;
}

export function ChatComposer({ input, isLoading, onInputChange, onSend, onStop }: ChatComposerProps) {
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
      <div className="mx-auto max-w-3xl">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your course materials..."
            className="min-h-[44px] max-h-[200px] resize-none"
            rows={1}
            disabled={isLoading}
          />

          <Button
            onClick={isLoading ? onStop : onSend}
            disabled={!isLoading && !input.trim()}
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

        <p className="mt-2 text-center text-xs text-muted-foreground">
          EduChat uses RAG to ground answers in your course materials
        </p>
      </div>
    </div>
  );
}
