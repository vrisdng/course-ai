import { useState } from 'react';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { BookOpen, Check, ChevronLeft, ChevronRight, Loader2, MessageSquare, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  isClearingConversations: boolean;
  isCollapsed: boolean;
  searchQuery: string;
  availableCourses: Course[];
  selectedCourseId: string | null;
  isLoadingCourses: boolean;
  onSelectConversation: (conversationId: string) => void;
  onStartNewConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onClearHistory: () => void;
  onToggleCollapse: () => void;
  onSearchChange: (query: string) => void;
  onChangeCourse: (courseId: string) => void;
  /** Called with the trimmed, uppercased invite code. Should throw on failure. */
  onEnroll: (code: string) => Promise<void>;
  showEnroll: boolean;
}

export function ConversationsSidebar({
  conversations,
  currentConversationId,
  deletingConversationId,
  isClearingConversations,
  isCollapsed,
  searchQuery,
  availableCourses,
  selectedCourseId,
  isLoadingCourses,
  onSelectConversation,
  onStartNewConversation,
  onDeleteConversation,
  onClearHistory,
  onToggleCollapse,
  onSearchChange,
  onChangeCourse,
  onEnroll,
  showEnroll,
}: ConversationsSidebarProps) {
  const [isCourseDialogOpen, setIsCourseDialogOpen] = useState(false);
  const [enrollCode, setEnrollCode] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);

  const filteredConversations = searchQuery.trim()
    ? conversations.filter((c) =>
      c.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
    )
    : conversations;

  const selectedCourse = availableCourses.find((c) => c.id === selectedCourseId);
  const hasCourses = availableCourses.length > 0;

  const handleEnrollSubmit = async () => {
    const code = enrollCode.trim().toUpperCase();
    if (!code) {
      toast.error('Enter a course code');
      return;
    }
    setIsEnrolling(true);
    try {
      await onEnroll(code);
      setEnrollCode('');
      setIsCourseDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to enroll');
    } finally {
      setIsEnrolling(false);
    }
  };

  const courseButtonLabel = isLoadingCourses
    ? 'Loading courses...'
    : !hasCourses && showEnroll
      ? 'Enroll in Course'
      : selectedCourse
        ? `${selectedCourse.name}${selectedCourse.code ? ` (${selectedCourse.code})` : ''}`
        : 'Select Course';

  const CourseIcon = !hasCourses && showEnroll ? UserPlus : BookOpen;

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
    <>
      <aside className="hidden w-64 shrink-0 border-r border-border bg-muted/30 md:block">
        <div className="flex h-full flex-col">
          {/* Header row: New Chat + collapse button */}
          <div className="flex items-center gap-2 p-3">
            <Button className="h-9 flex-1 gap-2" variant="outline" onClick={onStartNewConversation}>
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
            <Button
              variant="ghost"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
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

          {/* Course button */}
          <div className="px-3 pb-3">
            <Button
              variant="outline"
              className="h-8 w-full justify-start gap-2 px-3 text-sm font-normal"
              disabled={isLoadingCourses}
              onClick={() => setIsCourseDialogOpen(true)}
            >
              <CourseIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">{courseButtonLabel}</span>
            </Button>
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
                          disabled={deletingConversationId === conversation.id || isClearingConversations}
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

          {/* Footer: Clear History */}
          <div className="border-t border-border/60 p-3">
            <Button
              variant="outline"
              className="w-full gap-2 text-sm"
              onClick={onClearHistory}
              disabled={conversations.length === 0 || isClearingConversations || deletingConversationId !== null}
            >
              {isClearingConversations ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Clearing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Clear History
                </>
              )}
            </Button>
          </div>
        </div>
      </aside>

      {/* Course Manager Dialog */}
      <Dialog open={isCourseDialogOpen} onOpenChange={(open) => { if (!isEnrolling) setIsCourseDialogOpen(open); }}>
        <DialogContent className="sm:max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>{hasCourses ? 'Manage Courses' : 'Enroll in a Course'}</DialogTitle>
            <DialogDescription>
              {hasCourses
                ? 'Switch between your enrolled courses or join a new one.'
                : 'Enter the invite code provided by your instructor.'}
            </DialogDescription>
          </DialogHeader>

          {/* Enrolled courses list */}
          {hasCourses && (
            <div className="space-y-1 min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Your Courses ({availableCourses.length})
              </p>
              <ScrollArea className="max-h-48">
                <div className="space-y-1 pr-1">
                  {availableCourses.map((course) => {
                    const isActive = course.id === selectedCourseId;
                    return (
                      <button
                        key={course.id}
                        type="button"
                        onClick={() => { onChangeCourse(course.id); setIsCourseDialogOpen(false); }}
                        className={cn(
                          'flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-accent text-foreground'
                        )}
                      >
                        <BookOpen className="h-4 w-4 shrink-0" />
                        <span className="flex-1">
                          {course.name}{course.code ? ` (${course.code})` : ''}
                        </span>
                        {isActive && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Enroll form */}
          {showEnroll && (
            <>
              {hasCourses && <div className="border-t border-border/60" />}
              <div className="space-y-3 min-w-0">
                {hasCourses && (
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Enroll in Another Course</p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="sidebar-enroll-code">Invite code</Label>
                  <Input
                    id="sidebar-enroll-code"
                    placeholder="e.g. AB3X7KM2"
                    value={enrollCode}
                    onChange={(e) => setEnrollCode(e.target.value.toUpperCase())}
                    maxLength={8}
                    className="font-mono tracking-widest"
                    disabled={isEnrolling}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleEnrollSubmit(); } }}
                  />
                </div>
                <Button
                  className="w-full gap-2"
                  onClick={() => void handleEnrollSubmit()}
                  disabled={isEnrolling || enrollCode.trim().length === 0}
                >
                  {isEnrolling ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Enrolling...</>
                  ) : (
                    <><UserPlus className="h-4 w-4" />Enroll</>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
