import { BookOpen, PanelLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

import { useAuth } from '@/contexts/AuthContext';
import { usePersistedCollapse } from '@/lib/use-persisted-collapse';
import { supabase } from '@/integrations/supabase/client';

import { ChatComposer } from '@/features/student-chat/ChatComposer';
import { ConversationsSidebar } from '@/features/student-chat/ConversationsSidebar';
import { DocumentScopeSelector } from '@/features/student-chat/DocumentScopeSelector';
import { DocumentViewerDialog } from '@/features/student-chat/DocumentViewerDialog';
import { MessageList } from '@/features/student-chat/MessageList';
import { SourcesPanel } from '@/features/student-chat/SourcesPanel';
import { useStudentChat } from '@/features/student-chat/useStudentChat';

export default function StudentChat() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousRouteConversationIdRef = useRef<string | null>(null);
  const [isSidebarCollapsed, , toggleSidebarCollapse] = usePersistedCollapse('chat:sidebar-collapsed', true);
  const [conversationSearch, setConversationSearch] = useState('');
  // Phone-width sheet that hosts the conversations sidebar (the rail itself is hidden below `md`).
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId: routeConversationId } = useParams<{ conversationId?: string }>();
  const { refreshProfile, isAdmin } = useAuth();

  const {
    activeVideoSource,
    activeViewerSource,
    clearViewSource,
    fetchAccessibleCourses,
    availableCourses,
    isLoadingCourses,
    availableDocuments,
    isLoadingDocuments,
    messages,
    input,
    isLoading,
    showSidePanel,
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
    handleSend,
    stopGenerating,
    startNewConversation,
    selectConversation,
    deleteConversation,
    clearAllConversations,
    openSourcesForMessage,
    focusCitation,
    openCitationSource,
    openingCitationKey,
    clearClearViewSource,
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

  const sidebarProps = {
    conversations,
    currentConversationId,
    deletingConversationId,
    isClearingConversations,
    isCollapsed: isSidebarCollapsed,
    searchQuery: conversationSearch,
    availableCourses,
    selectedCourseId,
    isLoadingCourses,
    onSelectConversation: selectConversation,
    onStartNewConversation: handleStartNewConversation,
    onDeleteConversation: deleteConversation,
    onClearHistory: clearAllConversations,
    onToggleCollapse: toggleSidebarCollapse,
    onSearchChange: setConversationSearch,
    onChangeCourse: changeSelectedCourse,
    onEnroll: handleEnroll,
    showEnroll: !isAdmin,
  };

  const closeMobileNav = () => setIsMobileNavOpen(false);

  return (
    <MainLayout showFooter={false}>
      <div className="flex h-[calc(100vh-4rem)] supports-[height:100dvh]:h-[calc(100dvh-4rem)]">
        <ConversationsSidebar {...sidebarProps} />

        <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
          <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
            <SheetTitle className="sr-only">Conversations</SheetTitle>
            <SheetDescription className="sr-only">Switch course, search, or start a new chat</SheetDescription>
            {isMobileNavOpen && (
              <ConversationsSidebar
                {...sidebarProps}
                layout="drawer"
                onSelectConversation={(conversationId) => {
                  selectConversation(conversationId);
                  closeMobileNav();
                }}
                onStartNewConversation={() => {
                  handleStartNewConversation();
                  closeMobileNav();
                }}
                onChangeCourse={(courseId) => {
                  changeSelectedCourse(courseId);
                  closeMobileNav();
                }}
              />
            )}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-border px-3 py-2 sm:px-4">
            <div className="mx-auto flex max-w-5xl items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 md:hidden"
                aria-label="Open conversations"
                onClick={() => setIsMobileNavOpen(true)}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
              <BookOpen className="hidden h-4 w-4 shrink-0 text-primary md:block" />
              <span className="truncate text-sm text-muted-foreground">
                {selectedCourseLabel}
              </span>
            </div>
          </div>

          <ScrollArea className="flex-1 p-3 sm:p-4">
            <div className="mx-auto max-w-5xl space-y-6">
              <MessageList
                messages={messages}
                showEmptyState={!currentConversationId}
                onSuggestionClick={setInput}
                onOpenSources={openSourcesForMessage}
                onCitationClick={focusCitation}
                onCitationOpen={openCitationSource}
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
          activeViewerSource={activeViewerSource}
          activeVideoSource={activeVideoSource}
          openingCitationKey={openingCitationKey}
          onOpenPanel={() => setShowSidePanel(true)}
          onClosePanel={() => setShowSidePanel(false)}
        />
      </div>

      <DocumentViewerDialog source={clearViewSource} onClose={clearClearViewSource} />

    </MainLayout>
  );
}
