import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';

import { getCitationKey } from './citations';
import type { ActiveVideoSource } from './VideoSourceDialog';
import type { Citation, Conversation, Message } from './types';

const RAG_CHAT_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-chat`;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface RagChatFinalPayload {
  answer: string;
  citations: Citation[];
  conversationId: string;
}

interface AccessibleCourse {
  id: string;
  name: string;
  code: string | null;
  accessRole: string;
}

interface ParsedSseEvent {
  event: string;
  data: string;
}

function parseSseEventBlock(block: string): ParsedSseEvent | null {
  const normalized = block.replace(/\r/g, '');
  const lines = normalized.split('\n');
  const dataLines: string[] = [];
  let event = 'message';

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join('\n'),
  };
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function useStudentChat(routeConversationId: string | null = null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(true);
  const [highlightedCitationKey, setHighlightedCitationKey] = useState<string | null>(null);
  const [openingCitationKey, setOpeningCitationKey] = useState<string | null>(null);
  const [activeVideoSource, setActiveVideoSource] = useState<ActiveVideoSource | null>(null);
  const [availableCourses, setAvailableCourses] = useState<AccessibleCourse[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(routeConversationId);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const initialPreferredConversationIdRef = useRef<string | null>(
    routeConversationId
  );
  const previousRouteConversationIdRef = useRef<string | null>(routeConversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef(0);
  const activeAssistantMessageIdRef = useRef<string | null>(null);

  const cancelActiveRequest = useCallback(() => {
    activeRequestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  }, []);

  const fetchAccessibleCourses = useCallback(async () => {
    setIsLoadingCourses(true);

    const { data, error } = await supabase.rpc('list_accessible_courses');

    if (error) {
      console.error('Failed to load accessible courses:', error);
      toast.error('Failed to load your course list');
      setIsLoadingCourses(false);
      return;
    }

    const nextCourses: AccessibleCourse[] = (data || []).map((course) => ({
      id: course.id,
      name: course.name,
      code: course.code,
      accessRole: course.access_role,
    }));

    setAvailableCourses(nextCourses);
    setSelectedCourseId((current) => {
      if (current && nextCourses.some((course) => course.id === current)) {
        return current;
      }

      return nextCourses[0]?.id || null;
    });
    setIsLoadingCourses(false);
  }, []);

  const fetchConversations = useCallback(async (
    preferredConversationId?: string | null,
    options?: { requestId?: number }
  ) => {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, created_at, course_id')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Failed to load conversations:', error);
      return;
    }

    const nextConversations: Conversation[] = (data || []).map((conversation) => ({
      id: conversation.id,
      courseId: conversation.course_id,
      title: conversation.title || 'Untitled conversation',
      createdAt: conversation.created_at,
    }));

    setConversations(nextConversations);

    setCurrentConversationId((current) => {
      if (options?.requestId && activeRequestIdRef.current !== options.requestId) {
        return current;
      }

      if (preferredConversationId && nextConversations.some((conversation) => conversation.id === preferredConversationId)) {
        return preferredConversationId;
      }

      if (current && nextConversations.some((conversation) => conversation.id === current)) {
        return current;
      }

      return null;
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
      setActiveVideoSource(null);
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

    const chunkById: Record<string, { pageNumber: number | null; startMs: number | null; endMs: number | null; materialId: string | null; studentDocumentId: string | null }> = {};
    const materialById: Record<string, { fileName: string; fileType: string }> = {};
    const studentDocumentById: Record<string, { fileName: string; fileType: string }> = {};

    if (chunkIds.length > 0) {
      const { data: chunkRows, error: chunksError } = await supabase
        .from('chunks')
        .select('id, page_number, start_ms, end_ms, material_id, student_document_id')
        .in('id', chunkIds);

      if (chunksError) {
        console.error('Failed to load chunks:', chunksError);
      } else {
        for (const chunk of chunkRows || []) {
          chunkById[chunk.id] = {
            pageNumber: chunk.page_number,
            startMs: chunk.start_ms,
            endMs: chunk.end_ms,
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
        pageNumber: chunk?.pageNumber ?? undefined,
        startMs: chunk?.startMs ?? undefined,
        endMs: chunk?.endMs ?? undefined,
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
    setActiveVideoSource(null);
  }, []);

  useEffect(() => {
    void fetchAccessibleCourses();
  }, [fetchAccessibleCourses]);

  useEffect(() => {
    void fetchConversations(initialPreferredConversationIdRef.current);
  }, [fetchConversations]);

  useEffect(() => {
    if (routeConversationId === previousRouteConversationIdRef.current) {
      return;
    }

    previousRouteConversationIdRef.current = routeConversationId;

    if (!routeConversationId) {
      setCurrentConversationId(null);
      return;
    }

    setCurrentConversationId(routeConversationId);
  }, [routeConversationId]);

  useEffect(() => {
    if (!routeConversationId || conversations.length === 0) {
      return;
    }

    if (!conversations.some((conversation) => conversation.id === routeConversationId)) {
      toast.error('Conversation not found.');
      setCurrentConversationId(null);
    }
  }, [conversations, routeConversationId]);

  useEffect(() => {
    if (!currentConversationId) {
      if (!selectedCourseId && availableCourses.length > 0) {
        setSelectedCourseId(availableCourses[0].id);
      }
      return;
    }

    const activeConversation = conversations.find((conversation) => conversation.id === currentConversationId);
    if (activeConversation && activeConversation.courseId !== selectedCourseId) {
      setSelectedCourseId(activeConversation.courseId);
    }
  }, [availableCourses, conversations, currentConversationId, selectedCourseId]);

  useEffect(() => {
    if (!currentConversationId) {
      setMessages([]);
      return;
    }

    void loadConversationMessages(currentConversationId);
  }, [currentConversationId, loadConversationMessages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    if (!currentConversationId && !selectedCourseId) {
      toast.error('Select a course before starting a new chat');
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

    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    activeAssistantMessageIdRef.current = assistantMessageId;

    try {
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
        },
      ]);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const response = await fetch(RAG_CHAT_FUNCTION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        signal: abortController.signal,
        body: JSON.stringify({
          message: userMessage.content,
          conversationId: currentConversationId,
          courseId: selectedCourseId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const parsed = parseMaybeJson(errorText) as { error?: string } | string;
        if (typeof parsed === 'object' && parsed?.error) {
          throw new Error(parsed.error);
        }
        throw new Error(errorText || 'Failed to get response. Please try again.');
      }

      const responseContentType = response.headers.get('content-type') || '';
      let finalPayload: RagChatFinalPayload | null = null;

      if (responseContentType.includes('application/json')) {
        finalPayload = await response.json() as RagChatFinalPayload;
      } else {
        if (!response.body) {
          throw new Error('No response stream was returned.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const handleEvent = (event: ParsedSseEvent) => {
          const parsed = parseMaybeJson(event.data);

          if (event.event === 'token') {
            const delta = typeof parsed === 'object' && parsed && 'text' in parsed
              ? String((parsed as { text?: unknown }).text || '')
              : '';

            if (!delta || finalPayload || activeRequestIdRef.current !== requestId) {
              return;
            }

            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: `${message.content}${delta}` }
                  : message
              )
            );
            return;
          }

          if (event.event === 'final') {
            if (typeof parsed === 'object' && parsed) {
              finalPayload = parsed as RagChatFinalPayload;
            }
            return;
          }

          if (event.event === 'error') {
            const errorMessage = typeof parsed === 'object' && parsed && 'error' in parsed
              ? String((parsed as { error?: unknown }).error || '')
              : '';
            throw new Error(errorMessage || 'Streaming request failed.');
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (activeRequestIdRef.current !== requestId) {
            throw new DOMException('Request aborted', 'AbortError');
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

          let boundaryIndex = buffer.indexOf('\n\n');
          while (boundaryIndex !== -1) {
            const rawBlock = buffer.slice(0, boundaryIndex);
            buffer = buffer.slice(boundaryIndex + 2);

            const event = parseSseEventBlock(rawBlock);
            if (event) {
              handleEvent(event);
            }

            boundaryIndex = buffer.indexOf('\n\n');
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          const trailingEvent = parseSseEventBlock(buffer);
          if (trailingEvent) {
            handleEvent(trailingEvent);
          }
        }
      }

      if (!finalPayload) {
        // Stream ended without a "final" event (e.g. backend error during
        // DB persistence after the answer was already streamed). Keep
        // whatever content the user already saw instead of deleting it.
        console.warn('Stream ended without a final event — keeping partial content.');
        return;
      }

      if (activeRequestIdRef.current !== requestId) {
        return;
      }

      const { answer, citations, conversationId } = finalPayload;

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: answer, citations }
            : message
        )
      );

      await fetchConversations(conversationId || currentConversationId, { requestId });
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === 'AbortError'
      ) {
        return;
      }

      console.error('Chat error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get response. Please try again.';
      toast.error(message);

      setMessages((prev) => prev.filter((messageItem) => messageItem.id !== assistantMessageId && messageItem.id !== userMessage.id));
    } finally {
      if (activeRequestIdRef.current === requestId) {
        abortControllerRef.current = null;
        activeAssistantMessageIdRef.current = null;
        setIsLoading(false);
      }
    }
  }, [currentConversationId, fetchConversations, input, isLoading, selectedCourseId]);

  const stopGenerating = useCallback(() => {
    const activeAssistantMessageId = activeAssistantMessageIdRef.current;

    cancelActiveRequest();
    activeAssistantMessageIdRef.current = null;

    if (!activeAssistantMessageId) {
      return;
    }

    setMessages((prev) =>
      prev.filter((message) => message.id !== activeAssistantMessageId || message.content !== '')
    );
  }, [cancelActiveRequest]);

  const startNewConversation = useCallback(() => {
    cancelActiveRequest();
    setCurrentConversationId(null);
    setMessages([]);
    setSelectedMessage(null);
    setHighlightedCitationKey(null);
    setOpeningCitationKey(null);
    setActiveVideoSource(null);
  }, [cancelActiveRequest]);

  const selectConversation = useCallback((conversationId: string) => {
    cancelActiveRequest();
    const conversation = conversations.find((item) => item.id === conversationId);
    if (conversation) {
      setSelectedCourseId(conversation.courseId);
    }
    setCurrentConversationId(conversationId);
    setSelectedMessage(null);
    setHighlightedCitationKey(null);
    setOpeningCitationKey(null);
    setActiveVideoSource(null);
  }, [cancelActiveRequest, conversations]);

  const changeSelectedCourse = useCallback((courseId: string) => {
    if (courseId === selectedCourseId) {
      return;
    }

    cancelActiveRequest();
    setSelectedCourseId(courseId);
    setCurrentConversationId(null);
    setMessages([]);
    setSelectedMessage(null);
    setHighlightedCitationKey(null);
    setOpeningCitationKey(null);
    setActiveVideoSource(null);
  }, [cancelActiveRequest, selectedCourseId]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    const conversationTitle = conversation?.title || 'this conversation';
    const shouldDelete = window.confirm(`Delete "${conversationTitle}"? This cannot be undone.`);

    if (!shouldDelete) {
      return;
    }

    setDeletingConversationId(conversationId);

    try {
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId);

      if (error) {
        throw new Error(error.message);
      }

      const preferredConversationId = currentConversationId === conversationId ? null : currentConversationId;
      await fetchConversations(preferredConversationId);
      setSelectedMessage(null);
      setHighlightedCitationKey(null);
      toast.success('Conversation deleted');
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete conversation.';
      toast.error(message);
    } finally {
      setDeletingConversationId(null);
    }
  }, [conversations, currentConversationId, fetchConversations]);

  const openSourcesForMessage = useCallback((message: Message) => {
    setSelectedMessage(message);
    setShowSidePanel(true);
    setHighlightedCitationKey(null);
  }, []);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
  }, []);

  const focusCitation = useCallback((message: Message, citationNumber: number) => {
    if (!message.citations || message.citations.length === 0) return;

    const citationIndex = citationNumber - 1;
    if (!message.citations[citationIndex]) return;

    setSelectedMessage(message);
    setShowSidePanel(true);
    setHighlightedCitationKey(getCitationKey(message.id, citationNumber));
  }, []);

  const closeActiveVideoSource = useCallback(() => {
    setActiveVideoSource(null);
  }, []);

  const openCitationSource = useCallback(async (citation: Citation, citationKey: string) => {
    setOpeningCitationKey(citationKey);
    let previewWindow: Window | null = null;

    try {
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
      let fileType = citation.documentType;
      let fileName = citation.documentName;

      if (chunkRow.material_id) {
        const { data: materialRow, error: materialError } = await supabase
          .from('materials')
          .select('file_path, file_type, file_name')
          .eq('id', chunkRow.material_id)
          .maybeSingle();

        if (materialError || !materialRow?.file_path) {
          throw new Error(materialError?.message || 'Unable to locate source file');
        }

        bucket = 'course-materials';
        filePath = materialRow.file_path;
        fileType = materialRow.file_type;
        fileName = materialRow.file_name;
      } else if (chunkRow.student_document_id) {
        const { data: documentRow, error: documentError } = await supabase
          .from('student_documents')
          .select('file_path, file_type, file_name')
          .eq('id', chunkRow.student_document_id)
          .maybeSingle();

        if (documentError || !documentRow?.file_path) {
          throw new Error(documentError?.message || 'Unable to locate source file');
        }

        bucket = 'student-documents';
        filePath = documentRow.file_path;
        fileType = documentRow.file_type;
        fileName = documentRow.file_name;
      } else {
        throw new Error('Citation source has no linked document');
      }

      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(filePath, 120);

      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw new Error(signedUrlError?.message || 'Unable to generate source preview URL');
      }

      if (fileType === 'video') {
        setActiveVideoSource({
          title: fileName,
          signedUrl: signedUrlData.signedUrl,
          startMs: citation.startMs ?? 0,
          endMs: citation.endMs,
          excerpt: citation.excerpt,
        });
      } else {
        previewWindow = window.open('', '_blank');
        if (previewWindow) {
          previewWindow.location.href = signedUrlData.signedUrl;
        } else {
          window.open(signedUrlData.signedUrl, '_blank', 'noopener,noreferrer');
        }
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
  };
}
