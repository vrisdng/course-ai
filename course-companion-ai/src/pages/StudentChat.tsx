import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

import { MainLayout } from '@/components/layout/MainLayout';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { ChatComposer } from '@/features/student-chat/ChatComposer';
import { ConversationsSidebar } from '@/features/student-chat/ConversationsSidebar';
import { MessageList } from '@/features/student-chat/MessageList';
import { SourcesPanel } from '@/features/student-chat/SourcesPanel';
import { VideoSourceDialog } from '@/features/student-chat/VideoSourceDialog';
import { useStudentChat } from '@/features/student-chat/useStudentChat';

export default function StudentChat() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId: rosuteConversationId } = useParams<{ conversationId?: string }>();

  const {
    activeVideoSource,
    availableCourses,
    isLoadingCourses,
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
    deletingConversationId,
    changeSelectedCourse,
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
            <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Course Context
                </div>
                <p className="text-xs text-muted-foreground">
                  New chats retrieve materials only from the selected course.
                </p>
              </div>

              <div className="w-full sm:w-72">
                <Label htmlFor="chat-course-select" className="sr-only">
                  Course context
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
