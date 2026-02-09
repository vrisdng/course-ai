import { MessageSquare, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { Conversation } from './types';

interface ConversationsSidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onStartNewConversation: () => void;
}

export function ConversationsSidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onStartNewConversation,
}: ConversationsSidebarProps) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-muted/30 md:block">
      <div className="flex h-full flex-col">
        <div className="p-4">
          <Button className="w-full gap-2" variant="outline" onClick={onStartNewConversation}>
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1 py-2">
            {conversations.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No conversations yet. Start asking questions!
              </p>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => onSelectConversation(conversation.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    currentConversationId === conversation.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  )}
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span className="truncate">{conversation.title}</span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
