import { BarChart3, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

import type { AnalyticsChatMessage } from './useAnalyticsChat';

const SUGGESTIONS = [
  'What are the most frequent questions?',
  'Which documents are most referenced?',
  'What concepts do students most ask about?',
  'What topics should I add more materials for?',
];

interface AnalyticsChatMessageListProps {
  messages: AnalyticsChatMessage[];
  onSuggestionClick: (suggestion: string) => void;
}

export function AnalyticsChatMessageList({
  messages,
  onSuggestionClick,
}: AnalyticsChatMessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center pt-12 text-center">
        <div className="mb-4 rounded-full bg-primary/10 p-4">
          <BarChart3 className="h-8 w-8 text-primary" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-foreground">Course Analytics</h2>
        <p className="mb-6 max-w-md text-muted-foreground">
          Ask questions about student activity, popular topics, document usage, and more.
          Get actionable insights powered by your course data.
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
                <span className="text-sm text-muted-foreground">Analyzing data...</span>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
