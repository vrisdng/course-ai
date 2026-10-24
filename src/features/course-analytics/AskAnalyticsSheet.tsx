import { useEffect, useRef, useState } from 'react';
import { MessageSquare, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { AnalyticsChatMessageList } from '@/features/analytics-chat/AnalyticsChatMessageList';
import type { useAnalyticsChat } from '@/features/analytics-chat/useAnalyticsChat';
import { ChatComposer } from '@/features/student-chat/ChatComposer';

interface AskAnalyticsSheetProps {
  chat: ReturnType<typeof useAnalyticsChat>;
  // Why the chat can't be used right now (e.g. an invalid date range).
  disabledReason: string | null;
  rangeLabel: string | null;
}

// The analytics chat, in a side panel opened from the page's "Ask" card.
export function AskAnalyticsSheet({ chat, disabledReason, rangeLabel }: AskAnalyticsSheetProps) {
  const { messages, input, setInput, isLoading, handleSend, stopGenerating, clearChat } = chat;
  const [open, setOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Ask a question
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b border-border p-4 pr-12 text-left">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-base">Ask about this data</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8"
              onClick={clearChat}
              title="Clear chat"
              aria-label="Clear chat"
              disabled={messages.length === 0 && !isLoading}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
          <SheetDescription className="text-xs">
            {disabledReason ?? `Answers come from this course's usage data${rangeLabel ? ` for ${rangeLabel}` : ''}.`}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="space-y-6 p-4">
            <AnalyticsChatMessageList messages={messages} onSuggestionClick={setInput} />
            <div ref={endRef} />
          </div>
        </ScrollArea>
        <ChatComposer
          input={input}
          isLoading={isLoading}
          disabled={Boolean(disabledReason)}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={stopGenerating}
          placeholder="Ask about your course analytics..."
          footerText="Answers come from this course's usage data, not its materials."
        />
      </SheetContent>
    </Sheet>
  );
}
