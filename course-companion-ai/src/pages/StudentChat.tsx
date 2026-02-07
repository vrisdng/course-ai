import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MainLayout } from '@/components/layout/MainLayout';
import { 
  Send, 
  Loader2, 
  FileText, 
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  MessageSquare,
  Plus,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

interface Citation {
  id: string;
  chunkId: string;
  excerpt: string;
  documentName: string;
  documentType: string;
  pageNumber?: number;
  relevanceScore: number;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

export default function StudentChat() {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Create placeholder assistant message
      const assistantMessageId = crypto.randomUUID();
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
      }]);

      // Call the RAG chat edge function (to be implemented)
      const response = await supabase.functions.invoke('rag-chat', {
        body: {
          message: userMessage.content,
          conversationId: currentConversationId,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const { answer, citations, conversationId } = response.data;

      // Update assistant message with response
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { ...msg, content: answer, citations }
          : msg
      ));

      if (conversationId && !currentConversationId) {
        setCurrentConversationId(conversationId);
      }

    } catch (error) {
      console.error('Chat error:', error);
      toast.error('Failed to get response. Please try again.');
      // Remove the placeholder message on error
      setMessages(prev => prev.filter(msg => msg.role !== 'assistant' || msg.content !== ''));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startNewConversation = () => {
    setMessages([]);
    setCurrentConversationId(null);
    setSelectedMessage(null);
  };

  return (
    <MainLayout showFooter={false}>
      <div className="flex h-[calc(100vh-4rem)]">
        {/* Conversations Sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-border bg-muted/30 md:block">
          <div className="flex h-full flex-col">
            <div className="p-4">
              <Button 
                className="w-full gap-2" 
                variant="outline"
                onClick={startNewConversation}
              >
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
                  conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => setCurrentConversationId(conv.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                        currentConversationId === conv.id
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/50'
                      )}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      <span className="truncate">{conv.title}</span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </aside>

        {/* Main Chat Area */}
        <div className="flex flex-1 flex-col">
          <ScrollArea className="flex-1 p-4">
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="mb-4 rounded-full bg-primary/10 p-4">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="mb-2 text-xl font-semibold text-foreground">
                    Welcome to EduChat
                  </h2>
                  <p className="mb-6 max-w-md text-muted-foreground">
                    Ask questions about your course materials and get answers with citations. 
                    I'll show you exactly where the information comes from.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      'Explain the concept of machine learning',
                      'What are the key points from Week 3?',
                      'How does regression analysis work?',
                      'Summarize the main algorithms covered',
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setInput(suggestion)}
                        className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex gap-4',
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] px-4 py-3',
                        message.role === 'user'
                          ? 'chat-message-user'
                          : 'chat-message-assistant'
                      )}
                    >
                      {message.role === 'assistant' && message.content === '' ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm text-muted-foreground">Thinking...</span>
                        </div>
                      ) : (
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                      )}

                      {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
                        <button
                          onClick={() => {
                            setSelectedMessage(message);
                            setShowSidePanel(true);
                          }}
                          className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <FileText className="h-3 w-3" />
                          {message.citations.length} source{message.citations.length !== 1 ? 's' : ''}
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="border-t border-border bg-background p-4">
            <div className="mx-auto max-w-3xl">
              <div className="flex gap-2">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question about your course materials..."
                  className="min-h-[44px] max-h-[200px] resize-none"
                  rows={1}
                  disabled={isLoading}
                />
                <Button 
                  onClick={handleSend} 
                  disabled={!input.trim() || isLoading}
                  size="icon"
                  className="h-[44px] w-[44px] shrink-0"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                EduChat uses RAG to ground answers in your course materials
              </p>
            </div>
          </div>
        </div>

        {/* Citations Side Panel */}
        <aside
          className={cn(
            'border-l border-border bg-muted/30 transition-all duration-300',
            showSidePanel ? 'w-80' : 'w-0'
          )}
        >
          {showSidePanel && (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h3 className="font-semibold text-foreground">Sources</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSidePanel(false)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <ScrollArea className="flex-1 p-4">
                {selectedMessage?.citations && selectedMessage.citations.length > 0 ? (
                  <div className="space-y-3">
                    {selectedMessage.citations.map((citation, index) => (
                      <div key={citation.id} className="citation-card">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                              {index + 1}
                            </span>
                            <span className="text-xs font-medium text-foreground">
                              {citation.documentName}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {Math.round(citation.relevanceScore * 100)}% match
                          </span>
                        </div>
                        
                        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="h-3 w-3" />
                          <span className="capitalize">{citation.documentType}</span>
                          {citation.pageNumber && (
                            <>
                              <span>•</span>
                              <span>Page {citation.pageNumber}</span>
                            </>
                          )}
                        </div>

                        <p className="text-sm text-foreground/80 line-clamp-4">
                          "{citation.excerpt}"
                        </p>

                        <button className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
                          View full context
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileText className="mb-2 h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Click on a message with sources to see citations here
                    </p>
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </aside>

        {/* Toggle side panel button when hidden */}
        {!showSidePanel && (
          <button
            onClick={() => setShowSidePanel(true)}
            className="fixed right-0 top-1/2 -translate-y-1/2 rounded-l-lg border border-r-0 border-border bg-background p-2 shadow-md"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>
    </MainLayout>
  );
}
