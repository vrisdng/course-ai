import MoreVertIcon from '@mui/icons-material/MoreVert';
import { BookOpen, ChevronLeft, ChevronRight, Loader2, MessageSquare, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { Conversation } from './types';

interface Course {
  id: string;
  name: string;
  code?: string | null;
}

interface ConversationsSidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  deletingConversationId: string | null;
  isCollapsed: boolean;
  searchQuery: string;
  availableCourses: Course[];
  selectedCourseId: string | null;
  isLoadingCourses: boolean;
  onSelectConversation: (conversationId: string) => void;
  onStartNewConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onToggleCollapse: () => void;
  onSearchChange: (query: string) => void;
  onChangeCourse: (courseId: string) => void;
  onEnrollCourse: () => void;
  showEnroll: boolean;
}

export function ConversationsSidebar({
  conversations,
  currentConversationId,
  deletingConversationId,
  isCollapsed,
  searchQuery,
  availableCourses,
  selectedCourseId,
  isLoadingCourses,
  onSelectConversation,
  onStartNewConversation,
  onDeleteConversation,
  onToggleCollapse,
  onSearchChange,
  onChangeCourse,
  onEnrollCourse,
  showEnroll,
}: ConversationsSidebarProps) {
  const filteredConversations = searchQuery.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : conversations;

  if (isCollapsed) {
    return (
      <aside className="hidden shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col md:items-center md:py-3 md:w-12">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-muted/30 md:block">
      <div className="flex h-full flex-col">
        {/* Header row: New Chat + collapse button */}
        <div className="flex items-center gap-2 p-3">
          <Button className="flex-1 gap-2" variant="outline" onClick={onStartNewConversation}>
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 pl-8 pr-8 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Change Course */}
        <div className="px-3 pb-3">
          <Select
            value={selectedCourseId ?? undefined}
            onValueChange={onChangeCourse}
            disabled={isLoadingCourses || availableCourses.length === 0}
          >
            <SelectTrigger className="h-8 w-full gap-2 text-sm">
              <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <SelectValue placeholder={isLoadingCourses ? 'Loading...' : 'Change Course'} />
            </SelectTrigger>
            <SelectContent>
              {availableCourses.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.name}{course.code ? ` (${course.code})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mx-3 mb-2 border-t border-border/60" />

        {/* Conversation list */}
        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1 py-1">
            {filteredConversations.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {searchQuery ? 'No conversations match your search.' : 'No conversations yet. Start asking questions!'}
              </p>
            ) : (
              filteredConversations.map((conversation) => (
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

        {showEnroll && (
          <div className="border-t border-border/60 p-3">
            <Button variant="outline" className="w-full gap-2 text-sm" onClick={onEnrollCourse}>
              <UserPlus className="h-4 w-4" />
              Enroll in Course
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
