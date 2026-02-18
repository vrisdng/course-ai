import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { MainLayout } from '@/components/layout/MainLayout';
import { ScrollArea } from '@/components/ui/scroll-area';

import { ChatComposer } from '@/features/student-chat/ChatComposer';
import { ConversationsSidebar } from '@/features/student-chat/ConversationsSidebar';
import { MessageList } from '@/features/student-chat/MessageList';
import { SourcesPanel } from '@/features/student-chat/SourcesPanel';
import { useStudentChat } from '@/features/student-chat/useStudentChat';

export default function StudentChat() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId: routeConversationId } = useParams<{ conversationId?: string }>();

  const {
    messages,
    input,
    isLoading,
    selectedMessage,
    showSidePanel,
    highlightedCitationKey,
    openingCitationKey,
    conversations,
    currentConversationId,
    deletingConversationId,
    setInput,
    setShowSidePanel,
    setHighlightedCitationKey,
    handleSend,
    startNewConversation,
    selectConversation,
    deleteConversation,
    openSourcesForMessage,
    focusCitation,
    openCitationSource,
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
    </MainLayout>
  );
}
