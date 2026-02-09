import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';

import { getCitationKey } from './citations';
import type { Citation, Conversation, Message } from './types';

const MAX_CONVERSATIONS = 3;

export function useStudentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(true);
  const [highlightedCitationKey, setHighlightedCitationKey] = useState<string | null>(null);
  const [openingCitationKey, setOpeningCitationKey] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  const fetchConversations = useCallback(async (preferredConversationId?: string | null) => {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, created_at')
      .order('updated_at', { ascending: false })
      .limit(MAX_CONVERSATIONS);

    if (error) {
      console.error('Failed to load conversations:', error);
      return;
    }

    const nextConversations: Conversation[] = (data || []).map((conversation) => ({
      id: conversation.id,
      title: conversation.title || 'Untitled conversation',
      createdAt: conversation.created_at,
    }));

    setConversations(nextConversations);

    setCurrentConversationId((current) => {
      if (preferredConversationId && nextConversations.some((conversation) => conversation.id === preferredConversationId)) {
        return preferredConversationId;
      }

      if (current && nextConversations.some((conversation) => conversation.id === current)) {
        return current;
      }

      return nextConversations[0]?.id || null;
    });
  }, []);

  const loadConversationMessages = useCallback(async (conversationId: string) => {
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (messagesError) {
      console.error('Failed to load messages:', messagesError);
      toast.error('Failed to load message history');
      return;
    }

    const rows = messageRows || [];
    if (rows.length === 0) {
      setMessages([]);
      setSelectedMessage(null);
      setHighlightedCitationKey(null);
      return;
    }

    const messageIds = rows.map((row) => row.id);
    const { data: citationRows, error: citationsError } = await supabase
      .from('citations')
      .select('id, message_id, chunk_id, relevance_score, excerpt')
      .in('message_id', messageIds);

    if (citationsError) {
      console.error('Failed to load citations:', citationsError);
    }

    const citationsSafe = citationRows || [];
    const chunkIds = Array.from(new Set(citationsSafe.map((citation) => citation.chunk_id)));

    const chunkById: Record<string, { pageNumber: number | null; materialId: string | null; studentDocumentId: string | null }> = {};
    const materialById: Record<string, { fileName: string; fileType: string }> = {};
    const studentDocumentById: Record<string, { fileName: string; fileType: string }> = {};

    if (chunkIds.length > 0) {
      const { data: chunkRows, error: chunksError } = await supabase
        .from('chunks')
        .select('id, page_number, material_id, student_document_id')
        .in('id', chunkIds);

      if (chunksError) {
        console.error('Failed to load chunks:', chunksError);
      } else {
        for (const chunk of chunkRows || []) {
          chunkById[chunk.id] = {
            pageNumber: chunk.page_number,
            materialId: chunk.material_id,
            studentDocumentId: chunk.student_document_id,
          };
        }

        const materialIds = Array.from(
          new Set(
            (chunkRows || [])
              .map((chunk) => chunk.material_id)
              .filter((id): id is string => Boolean(id))
          )
        );

        const studentDocumentIds = Array.from(
          new Set(
            (chunkRows || [])
              .map((chunk) => chunk.student_document_id)
              .filter((id): id is string => Boolean(id))
          )
        );

        if (materialIds.length > 0) {
          const { data: materialRows, error: materialsError } = await supabase
            .from('materials')
            .select('id, file_name, file_type')
            .in('id', materialIds);

          if (materialsError) {
            console.error('Failed to load citation materials:', materialsError);
          } else {
            for (const material of materialRows || []) {
              materialById[material.id] = {
                fileName: material.file_name,
                fileType: material.file_type,
              };
            }
          }
        }

        if (studentDocumentIds.length > 0) {
          const { data: documentRows, error: documentsError } = await supabase
            .from('student_documents')
            .select('id, file_name, file_type')
            .in('id', studentDocumentIds);

          if (documentsError) {
            console.error('Failed to load citation student documents:', documentsError);
          } else {
            for (const document of documentRows || []) {
              studentDocumentById[document.id] = {
                fileName: document.file_name,
                fileType: document.file_type,
              };
            }
          }
        }
      }
    }

    const citationsByMessageId: Record<string, Citation[]> = {};
    for (const citation of citationsSafe) {
      const chunk = chunkById[citation.chunk_id];
      const material = chunk?.materialId ? materialById[chunk.materialId] : undefined;
      const studentDocument = chunk?.studentDocumentId ? studentDocumentById[chunk.studentDocumentId] : undefined;

      const normalizedCitation: Citation = {
        id: citation.id,
        chunkId: citation.chunk_id,
        excerpt: citation.excerpt || '',
        documentName: material?.fileName || studentDocument?.fileName || 'Unknown document',
        documentType: material?.fileType || studentDocument?.fileType || 'document',
        pageNumber: chunk?.pageNumber || undefined,
        relevanceScore: citation.relevance_score ?? 0,
      };

      if (!citationsByMessageId[citation.message_id]) {
        citationsByMessageId[citation.message_id] = [];
      }
      citationsByMessageId[citation.message_id].push(normalizedCitation);
    }

    const hydratedMessages: Message[] = rows.map((row) => ({
      id: row.id,
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: row.content,
      citations: citationsByMessageId[row.id] || undefined,
    }));

    setMessages(hydratedMessages);
    setSelectedMessage(null);
    setHighlightedCitationKey(null);
  }, []);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!currentConversationId) {
      setMessages([]);
      return;
    }

    void loadConversationMessages(currentConversationId);
  }, [currentConversationId, loadConversationMessages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    if (!currentConversationId && conversations.length >= MAX_CONVERSATIONS) {
      toast.error(`Conversation limit reached (max ${MAX_CONVERSATIONS}). Continue an existing conversation.`);
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    };
    const assistantMessageId = crypto.randomUUID();

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
        },
      ]);

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

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: answer, citations }
            : message
        )
      );

      if (conversationId && !currentConversationId) {
        setCurrentConversationId(conversationId);
      }

      await fetchConversations(conversationId || currentConversationId);
    } catch (error) {
      console.error('Chat error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get response. Please try again.';
      toast.error(message);

      setMessages((prev) => prev.filter((messageItem) => messageItem.id !== assistantMessageId && messageItem.id !== userMessage.id));
    } finally {
      setIsLoading(false);
    }
  }, [conversations.length, currentConversationId, fetchConversations, input, isLoading]);

  const startNewConversation = useCallback(() => {
    if (conversations.length >= MAX_CONVERSATIONS) {
      toast.error(`Conversation limit reached (max ${MAX_CONVERSATIONS}). Continue an existing conversation.`);
      return;
    }

    setCurrentConversationId(null);
    setMessages([]);
    setSelectedMessage(null);
    setHighlightedCitationKey(null);
  }, [conversations.length]);

  const selectConversation = useCallback((conversationId: string) => {
    setCurrentConversationId(conversationId);
    setSelectedMessage(null);
    setHighlightedCitationKey(null);
  }, []);

  const openSourcesForMessage = useCallback((message: Message) => {
    setSelectedMessage(message);
    setShowSidePanel(true);
    setHighlightedCitationKey(null);
  }, []);

  const focusCitation = useCallback((message: Message, citationNumber: number) => {
    if (!message.citations || message.citations.length === 0) return;

    const citationIndex = citationNumber - 1;
    if (!message.citations[citationIndex]) return;

    setSelectedMessage(message);
    setShowSidePanel(true);
    setHighlightedCitationKey(getCitationKey(message.id, citationNumber));
  }, []);

  const openCitationSource = useCallback(async (citation: Citation, citationKey: string) => {
    setOpeningCitationKey(citationKey);
    let previewWindow: Window | null = null;

    try {
      previewWindow = window.open('', '_blank');

      const { data: chunkRow, error: chunkError } = await supabase
        .from('chunks')
        .select('material_id, student_document_id')
        .eq('id', citation.chunkId)
        .maybeSingle();

      if (chunkError || !chunkRow) {
        throw new Error(chunkError?.message || 'Unable to locate citation source chunk');
      }

      let bucket = '';
      let filePath = '';

      if (chunkRow.material_id) {
        const { data: materialRow, error: materialError } = await supabase
          .from('materials')
          .select('file_path')
          .eq('id', chunkRow.material_id)
          .maybeSingle();

        if (materialError || !materialRow?.file_path) {
          throw new Error(materialError?.message || 'Unable to locate source file');
        }

        bucket = 'course-materials';
        filePath = materialRow.file_path;
      } else if (chunkRow.student_document_id) {
        const { data: documentRow, error: documentError } = await supabase
          .from('student_documents')
          .select('file_path')
          .eq('id', chunkRow.student_document_id)
          .maybeSingle();

        if (documentError || !documentRow?.file_path) {
          throw new Error(documentError?.message || 'Unable to locate source file');
        }

        bucket = 'student-documents';
        filePath = documentRow.file_path;
      } else {
        throw new Error('Citation source has no linked document');
      }

      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(filePath, 120);

      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw new Error(signedUrlError?.message || 'Unable to generate source preview URL');
      }

      if (previewWindow) {
        previewWindow.location.href = signedUrlData.signedUrl;
      } else {
        window.open(signedUrlData.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      if (previewWindow) {
        previewWindow.close();
      }

      const message = error instanceof Error ? error.message : 'Failed to open source context';
      toast.error(message);
    } finally {
      setOpeningCitationKey(null);
    }
  }, []);

  return {
    messages,
    input,
    isLoading,
    selectedMessage,
    showSidePanel,
    highlightedCitationKey,
    openingCitationKey,
    conversations,
    currentConversationId,
    setInput,
    setShowSidePanel,
    setHighlightedCitationKey,
    handleSend,
    startNewConversation,
    selectConversation,
    openSourcesForMessage,
    focusCitation,
    openCitationSource,
  };
}
