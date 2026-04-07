import { BookOpen, Loader2, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

import { ChatComposer } from '@/features/student-chat/ChatComposer';
import { ConversationsSidebar } from '@/features/student-chat/ConversationsSidebar';
import { DocumentScopeSelector } from '@/features/student-chat/DocumentScopeSelector';
import { MessageList } from '@/features/student-chat/MessageList';
import { SourcesPanel } from '@/features/student-chat/SourcesPanel';
import { VideoSourceDialog } from '@/features/student-chat/VideoSourceDialog';
import { useStudentChat } from '@/features/student-chat/useStudentChat';

export default function StudentChat() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [isEnrollOpen, setIsEnrollOpen] = useState(false);
  const [enrollCode, setEnrollCode] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId: routeConversationId } = useParams<{ conversationId?: string }>();
  const { refreshProfile, isAdmin } = useAuth();

  const {
    activeVideoSource,
    availableCourses,
    isLoadingCourses,
    availableDocuments,
    isLoadingDocuments,
    messages,
    input,
    isLoading,
    selectedMessage,
    showSidePanel,
    highlightedCitationKey,
    openingCitationKey,
    conversations,
    currentConversationId,
    selectedCourseId,
    selectedDocumentIds,
    deletingConversationId,
    changeSelectedCourse,
    toggleSelectedDocument,
    clearSelectedDocuments,
    setInput,
    setShowSidePanel,
    setHighlightedCitationKey,
    handleSend,
    stopGenerating,
    startNewConversation,
    selectConversation,
    deleteConversation,
    openSourcesForMessage,
    focusCitation,
    openCitationSource,
    closeActiveVideoSource,
  } = useStudentChat(routeConversationId || null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const targetPath = currentConversationId ? `/chat/${currentConversationId}` : '/chat';
    if (location.pathname === targetPath) return;
    navigate(targetPath, { replace: true });
  }, [currentConversationId, location.pathname, navigate]);

  const handleStartNewConversation = () => {
    if (location.pathname !== '/chat') {
      navigate('/chat', { replace: true });
    }
    startNewConversation();
  };

  const handleEnroll = async () => {
    const code = enrollCode.trim().toUpperCase();
    if (!code) {
      toast.error('Enter a course code');
      return;
    }

    setIsEnrolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('redeem-course-invite', {
        body: { inviteCode: code },
      });

      if (error || data?.error) {
        toast.error(error?.message || data?.error || 'Invalid or expired code');
        return;
      }

      await refreshProfile();
      toast.success(
        data?.status === 'already_enrolled'
          ? 'You are already enrolled in this course.'
          : 'Successfully enrolled!'
      );
      setIsEnrollOpen(false);
      setEnrollCode('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to enroll');
    } finally {
      setIsEnrolling(false);
    }
  };

  const selectedCourse = availableCourses.find((course) => course.id === selectedCourseId);
  const selectedCourseLabel = isLoadingCourses
    ? 'Loading course...'
    : selectedCourse
      ? `${selectedCourse.name}${selectedCourse.code ? ` (${selectedCourse.code})` : ''}`
      : 'No course selected';

  return (
    <MainLayout showFooter={false}>
      <div className="flex h-[calc(100vh-4rem)]">
        <ConversationsSidebar
          conversations={conversations}
          currentConversationId={currentConversationId}
          deletingConversationId={deletingConversationId}
          isCollapsed={isSidebarCollapsed}
          searchQuery={conversationSearch}
          availableCourses={availableCourses}
          selectedCourseId={selectedCourseId}
          isLoadingCourses={isLoadingCourses}
          onSelectConversation={selectConversation}
          onStartNewConversation={handleStartNewConversation}
          onDeleteConversation={deleteConversation}
          onToggleCollapse={() => setIsSidebarCollapsed((c) => !c)}
          onSearchChange={setConversationSearch}
          onChangeCourse={changeSelectedCourse}
          onEnrollCourse={() => setIsEnrollOpen(true)}
          showEnroll={!isAdmin}
        />

        <div className="flex flex-1 flex-col">
          <div className="border-b border-border px-4 py-2">
            <div className="mx-auto flex max-w-3xl items-center gap-2">
              <BookOpen className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm text-muted-foreground">
                {selectedCourseLabel}
              </span>
            </div>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="mx-auto max-w-3xl space-y-6">
              <MessageList
                messages={messages}
                onSuggestionClick={setInput}
                onOpenSources={openSourcesForMessage}
                onCitationClick={focusCitation}
              />
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <ChatComposer
            input={input}
            isLoading={isLoading}
            onInputChange={setInput}
            onSend={handleSend}
            onStop={stopGenerating}
            documentSelector={(
              <DocumentScopeSelector
                documents={availableDocuments}
                selectedDocumentIds={selectedDocumentIds}
                isLoading={isLoadingDocuments}
                disabled={!selectedCourseId}
                buttonClassName="w-auto max-w-full justify-between gap-3 px-3 text-left font-normal"
                onToggleDocument={toggleSelectedDocument}
                onClearSelection={clearSelectedDocuments}
              />
            )}
            documentHint={selectedCourseId && !isLoadingDocuments && availableDocuments.length === 0
              ? 'No processed documents are available for this course yet.'
              : null}
          />
        </div>

        <SourcesPanel
          showSidePanel={showSidePanel}
          selectedMessage={selectedMessage}
          highlightedCitationKey={highlightedCitationKey}
          openingCitationKey={openingCitationKey}
          onOpenPanel={() => setShowSidePanel(true)}
          onClosePanel={() => setShowSidePanel(false)}
          onClearHighlight={() => setHighlightedCitationKey(null)}
          onOpenCitationSource={openCitationSource}
        />
      </div>

      <VideoSourceDialog source={activeVideoSource} onClose={closeActiveVideoSource} />

      <Dialog
        open={isEnrollOpen}
        onOpenChange={(open) => {
          if (!isEnrolling) {
            setIsEnrollOpen(open);
            if (!open) setEnrollCode('');
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enroll in a Course</DialogTitle>
            <DialogDescription>
              Enter the 8-character code provided by your instructor.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="enroll-code">Course code</Label>
            <Input
              id="enroll-code"
              placeholder="e.g. AB3X7KM2"
              value={enrollCode}
              onChange={(e) => setEnrollCode(e.target.value.toUpperCase())}
              maxLength={8}
              className="font-mono text-lg tracking-widest"
              disabled={isEnrolling}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleEnroll();
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setIsEnrollOpen(false); setEnrollCode(''); }}
              disabled={isEnrolling}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleEnroll()}
              disabled={isEnrolling || enrollCode.trim().length === 0}
            >
              {isEnrolling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enrolling...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Enroll
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
