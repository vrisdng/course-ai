import { ChevronRight, FileText, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

import { markdownWithCitationLinks } from './citations';
import { formatTimestamp } from './time';
import type { Message } from './types';

const SUGGESTIONS = [
  'Explain this concept in simple terms',
  'What are the key takeaways?',
  'How does this idea work step by step?',
  'Summarize the most important points',
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
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={(url) => (url.startsWith('citation:') ? url : defaultUrlTransform(url))}
                  components={{
                    table: ({ children }) => (
                      <div className="my-3 w-full overflow-x-auto">
                        <table className="w-full border-collapse text-sm">{children}</table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead className="border-b border-border/60 bg-muted/40">{children}</thead>
                    ),
                    tbody: ({ children }) => (
                      <tbody className="divide-y divide-border/40">{children}</tbody>
                    ),
                    tr: ({ children }) => (
                      <tr className="transition-colors hover:bg-muted/20">{children}</tr>
                    ),
                    th: ({ children }) => (
                      <th className="border-r border-border/40 px-3 py-2 text-left text-xs font-semibold text-muted-foreground last:border-r-0">{children}</th>
                    ),
                    td: ({ children }) => (
                      <td className="border-r border-border/40 px-3 py-2 last:border-r-0">{children}</td>
                    ),
                    a: ({ href, children }) => {
                      if (href?.startsWith('citation:')) {
                        const citationNumber = Number(href.split(':')[1]);
                        const citation = message.citations?.[citationNumber - 1];

                        if (Number.isFinite(citationNumber)) {
                          if (!citation) {
                            return (
                              <span className="mx-0.5 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                [{citationNumber}]
                              </span>
                            );
                          }

                          const isVideo = citation.documentType === 'video';
                          const timestampHint = isVideo && typeof citation.startMs === 'number'
                            ? ` @ ${formatTimestamp(citation.startMs)}`
                            : '';

                          return (
                            <button
                              type="button"
                              title={`Source ${citationNumber}: ${citation.documentName}${timestampHint}`}
                              className="mx-0.5 inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onCitationClick(message, citationNumber);
                              }}
                            >
                              [{citationNumber}]{isVideo && typeof citation.startMs === 'number' && (
                                <span className="opacity-70">{formatTimestamp(citation.startMs)}</span>
                              )}
                            </button>
                          );
                        }
                      }

                      if (!href || href === '#' || href === '') {
                        return <span className="font-semibold">{children}</span>;
                      }

                      return (
                        <a 
                          href={href} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {markdownWithCitationLinks(message.content, message.citations?.length)}
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
