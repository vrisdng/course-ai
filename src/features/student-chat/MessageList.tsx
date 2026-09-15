import { ChevronRight, FileText, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { MessageContent } from './MessageContent';
import type { Citation, Message } from './types';

const SUGGESTIONS = [
  'Explain this concept in simple terms',
  'What are the key takeaways?',
  'How does this idea work step by step?',
  'Summarize the most important points',
];

interface MessageListProps {
  messages: Message[];
  showEmptyState?: boolean;
  onSuggestionClick: (suggestion: string) => void;
  onOpenSources: (message: Message) => void;
  onCitationClick: (message: Message, citationNumber: number) => void;
  onCitationOpen?: (citation: Citation, citationKey: string) => void;
}

export function MessageList({
  messages,
  showEmptyState = true,
  onSuggestionClick,
  onOpenSources,
  onCitationClick,
  onCitationOpen,
}: MessageListProps) {
  if (messages.length === 0) {
    if (!showEmptyState) {
      return null;
    }

    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <img src="/logo.png" alt="EduChat Logo" className="h-20 w-20" />
        <h2 className="mb-2 text-xl font-semibold text-foreground">Welcome to EduChat</h2>
        <p className="mb-6 max-w-md text-muted-foreground">
          Select your course and ask me a question!
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => onSuggestionClick(suggestion)}
              className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn('flex gap-4', message.role === 'user' ? 'justify-end' : 'justify-start')}
        >
          <div
            className={cn(
              'max-w-[85%] px-4 py-3',
              message.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'
            )}
          >
            {message.role === 'assistant' && message.content === '' ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            ) : (
              <MessageContent
                message={message}
                onCitationClick={onCitationClick}
                onCitationOpen={onCitationOpen}
              />
            )}

            {/* {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
              <button
                onClick={() => onOpenSources(message)}
                className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <FileText className="h-3 w-3" />
                {message.citations.length} source{message.citations.length !== 1 ? 's' : ''}
                <ChevronRight className="h-3 w-3" />
              </button>
            )} */}
          </div>
        </div>
      ))}
    </>
  );
}
