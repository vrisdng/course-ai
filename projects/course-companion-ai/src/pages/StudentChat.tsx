import { BookOpen, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
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
  const previousRouteConversationIdRef = useRef<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');

  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId: routeConversationId } = useParams<{ conversationId?: string }>();
  const { refreshProfile, isAdmin } = useAuth();

  const {
    activeVideoSource,
    fetchAccessibleCourses,
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
    selectedModel,
    setSelectedModel,
    deletingConversationId,
    isClearingConversations,
    changeSelectedCourse,
    toggleSelectedDocument,
    clearSelectedDocuments,
    selectAllDocuments,
    applySelectedDocuments,
    setInput,
    setShowSidePanel,
    setHighlightedCitationKey,
    handleSend,
    stopGenerating,
    startNewConversation,
    selectConversation,
    deleteConversation,
    clearAllConversations,
    openSourcesForMessage,
    focusCitation,
    openCitationSource,
    closeActiveVideoSource,
  } = useStudentChat(routeConversationId || null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const normalizedRouteConversationId = routeConversationId || null;
    const previousRouteConversationId = previousRouteConversationIdRef.current;
    const routeConversationChanged = normalizedRouteConversationId !== previousRouteConversationId;

    if (routeConversationChanged && currentConversationId !== normalizedRouteConversationId) {
      return;
    }

    const targetPath = currentConversationId ? `/chat/${currentConversationId}` : '/chat';
    if (location.pathname === targetPath) return;
    navigate(targetPath, { replace: true });
  }, [currentConversationId, location.pathname, navigate, routeConversationId]);

  useEffect(() => {
    previousRouteConversationIdRef.current = routeConversationId || null;
  }, [routeConversationId]);

  const handleStartNewConversation = () => {
    if (location.pathname !== '/chat') {
      navigate('/chat', { replace: true });
    }
    startNewConversation();
  };

  const handleEnroll = async (code: string): Promise<void> => {
    const { data, error } = await supabase.functions.invoke('redeem-course-invite', {
      body: { inviteCode: code },
    });

    if (error || data?.error) {
      throw new Error(error?.message || data?.error || 'Invalid or expired code');
    }

    await Promise.all([refreshProfile(), fetchAccessibleCourses()]);
    toast.success(
      data?.status === 'already_enrolled'
        ? 'You are already enrolled in this course.'
        : 'Successfully enrolled!'
    );
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
          isClearingConversations={isClearingConversations}
          isCollapsed={isSidebarCollapsed}
          searchQuery={conversationSearch}
          availableCourses={availableCourses}
          selectedCourseId={selectedCourseId}
          isLoadingCourses={isLoadingCourses}
          onSelectConversation={selectConversation}
          onStartNewConversation={handleStartNewConversation}
          onDeleteConversation={deleteConversation}
          onClearHistory={clearAllConversations}
          onToggleCollapse={() => setIsSidebarCollapsed((c) => !c)}
          onSearchChange={setConversationSearch}
          onChangeCourse={changeSelectedCourse}
          onEnroll={handleEnroll}
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
                showEmptyState={!currentConversationId}
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
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            documentSelector={(
              <DocumentScopeSelector
                documents={availableDocuments}
                selectedDocumentIds={selectedDocumentIds}
                isLoading={isLoadingDocuments}
                disabled={!selectedCourseId}
                buttonClassName="w-auto max-w-full justify-between gap-3 px-3 text-left font-normal"
                onSelectAllDocuments={selectAllDocuments}
                onClearSelection={clearSelectedDocuments}
                onApplySelection={applySelectedDocuments}
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
