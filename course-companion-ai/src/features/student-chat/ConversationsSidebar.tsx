import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { Conversation } from './types';

interface ConversationsSidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  deletingConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onStartNewConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
}

export function ConversationsSidebar({
  conversations,
  currentConversationId,
  deletingConversationId,
  onSelectConversation,
  onStartNewConversation,
  onDeleteConversation,
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
                <div
                  key={conversation.id}
                  className={cn(
                    'group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg pr-1 transition-colors',
                    currentConversationId === conversation.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation(conversation.id)}
                    className="flex min-w-0 items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    <MessageSquare className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={deletingConversationId === conversation.id}
                        className="h-7 w-7 shrink-0 text-muted-foreground"
                        aria-label={`More actions for ${conversation.title}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {deletingConversationId === conversation.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreVertIcon sx={{ fontSize: 18 }} />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={(event) => {
                          event.preventDefault();
                          onDeleteConversation(conversation.id);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
