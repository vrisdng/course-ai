import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { MainLayout } from '@/components/layout/MainLayout';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { ChatComposer } from '@/features/student-chat/ChatComposer';
import { ConversationsSidebar } from '@/features/student-chat/ConversationsSidebar';
import { DocumentScopeSelector } from '@/features/student-chat/DocumentScopeSelector';
import { MessageList } from '@/features/student-chat/MessageList';
import { SourcesPanel } from '@/features/student-chat/SourcesPanel';
import { VideoSourceDialog } from '@/features/student-chat/VideoSourceDialog';
import { useStudentChat } from '@/features/student-chat/useStudentChat';

export default function StudentChat() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isCourseContextExpanded, setIsCourseContextExpanded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId: routeConversationId } = useParams<{ conversationId?: string }>();

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
    documentScopeSummary,
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

    if (location.pathname === targetPath) {
      return;
    }

    navigate(targetPath, { replace: true });
  }, [currentConversationId, location.pathname, navigate]);

  const handleStartNewConversation = () => {
    if (location.pathname !== '/chat') {
      navigate('/chat', { replace: true });
    }
    startNewConversation();
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
          onSelectConversation={selectConversation}
          onStartNewConversation={handleStartNewConversation}
          onDeleteConversation={deleteConversation}
        />

        <div className="flex flex-1 flex-col">
          <div className="border-b border-border px-4 py-3">
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              <button
                type="button"
                onClick={() => setIsCourseContextExpanded((current) => !current)}
                className="flex items-center justify-between gap-3 rounded-md text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <BookOpen className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">Course Context: {selectedCourseLabel}</span>
                  </div>
                  {isCourseContextExpanded ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      New chats retrieve materials only from the selected course and optional document scope.
                    </p>
                  ) : null}
                </div>
                {isCourseContextExpanded ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>

              {isCourseContextExpanded ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="chat-course-select" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Course
                    </Label>
                    <Select
                      value={selectedCourseId ?? undefined}
                      onValueChange={changeSelectedCourse}
                      disabled={isLoadingCourses || availableCourses.length === 0}
                    >
                      <SelectTrigger id="chat-course-select">
                        <SelectValue placeholder={isLoadingCourses ? 'Loading courses...' : 'Select a course'} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCourses.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name} {course.code ? `(${course.code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : null}
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
            documentScopeSummary={documentScopeSummary}
            documentHint={selectedCourseId && !isLoadingDocuments && availableDocuments.length === 0
              ? 'No processed documents are available for this course yet.'
              : null}
            footerText={`EduChat grounds answers in ${documentScopeSummary === 'All course documents' ? 'the selected course materials' : `the selected documents: ${documentScopeSummary}`}`}
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
    </MainLayout>
  );
}
