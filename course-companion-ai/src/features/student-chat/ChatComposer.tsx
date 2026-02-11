import { useEffect, useRef } from 'react';
import { Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ChatComposerProps {
  input: string;
  isLoading: boolean;
  onInputChange: (nextValue: string) => void;
  onSend: () => void;
}

export function ChatComposer({ input, isLoading, onInputChange, onSend }: ChatComposerProps) {
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
            onClick={onSend}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-[44px] w-[44px] shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
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
