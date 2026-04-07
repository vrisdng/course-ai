import { BookOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { MainLayout } from '@/components/layout/MainLayout';
import { ScrollArea } from '@/components/ui/scroll-area';

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
        />

        <div className="flex flex-1 flex-col">
          {/* Top bar: current course context (read-only label) */}
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
    </MainLayout>
  );
}
