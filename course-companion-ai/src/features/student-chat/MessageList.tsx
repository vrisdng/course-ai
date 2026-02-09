import ReactMarkdown from 'react-markdown';
import { ChevronRight, FileText, Loader2, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

import { markdownWithCitationLinks } from './citations';
import type { Message } from './types';

const SUGGESTIONS = [
  'Explain the concept of machine learning',
  'What are the key points from Week 3?',
  'How does regression analysis work?',
  'Summarize the main algorithms covered',
];

interface MessageListProps {
  messages: Message[];
  onSuggestionClick: (suggestion: string) => void;
  onOpenSources: (message: Message) => void;
  onCitationClick: (message: Message, citationNumber: number) => void;
}

export function MessageList({
  messages,
  onSuggestionClick,
  onOpenSources,
  onCitationClick,
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 rounded-full bg-primary/10 p-4">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-foreground">Welcome to EduChat</h2>
        <p className="mb-6 max-w-md text-muted-foreground">
          Ask questions about your course materials and get answers with citations.
          I'll show you exactly where the information comes from.
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
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => {
                      if (href?.startsWith('citation:')) {
                        const citationNumber = Number(href.split(':')[1]);

                        if (Number.isFinite(citationNumber)) {
                          return (
                            <button
                              type="button"
                              className="font-semibold text-primary underline-offset-2 hover:underline"
                              onClick={() => onCitationClick(message, citationNumber)}
                            >
                              [{citationNumber}]
                            </button>
                          );
                        }
                      }

                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {markdownWithCitationLinks(message.content)}
                </ReactMarkdown>
              </div>
            )}

            {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
              <button
                onClick={() => onOpenSources(message)}
                className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <FileText className="h-3 w-3" />
                {message.citations.length} source{message.citations.length !== 1 ? 's' : ''}
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
