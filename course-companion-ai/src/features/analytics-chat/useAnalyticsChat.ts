import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';

const ANALYTICS_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analytics-chat`;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface AnalyticsChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ParsedSseEvent {
  event: string;
  data: string;
}

function parseSseEventBlock(block: string): ParsedSseEvent | null {
  const lines = block.replace(/\r/g, '').split('\n');
  const dataLines: string[] = [];
  let event = 'message';

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function useAnalyticsChat(courseId: string | null) {
  const [messages, setMessages] = useState<AnalyticsChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef(0);

  // Clear messages when course changes
  useEffect(() => {
    setMessages([]);
    setInput('');
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }, [courseId]);

  const clearChat = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setIsLoading(false);
  }, []);

  const stopGenerating = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    if (!courseId) {
      toast.error('Select a course first');
      return;
    }

    const userMessage: AnalyticsChatMessage = {
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

    try {
      setMessages((prev) => [
        ...prev,
        { id: assistantMessageId, role: 'assistant', content: '' },
      ]);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);

      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Your session has expired. Please sign in again.');

      // Build history from current messages (before the new ones we just added)
      const history = messages
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch(ANALYTICS_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        signal: abortController.signal,
        body: JSON.stringify({
          message: userMessage.content,
          courseId,
          history,
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

      let finalReceived = false;

      const responseContentType = response.headers.get('content-type') || '';
      if (responseContentType.includes('application/json')) {
        const json = (await response.json()) as { answer?: string };
        if (json.answer) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId ? { ...m, content: json.answer! } : m
            )
          );
          finalReceived = true;
        }
      } else {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const handleEvent = (event: ParsedSseEvent) => {
          const parsed = parseMaybeJson(event.data);

          if (event.event === 'token') {
            const delta =
              typeof parsed === 'object' && parsed && 'text' in parsed
                ? String((parsed as { text?: unknown }).text || '')
                : '';

            if (!delta || finalReceived || activeRequestIdRef.current !== requestId) return;

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? { ...m, content: `${m.content}${delta}` } : m
              )
            );
            return;
          }

          if (event.event === 'final') {
            if (typeof parsed === 'object' && parsed) {
              const answer = (parsed as { answer?: string }).answer;
              if (answer) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId ? { ...m, content: answer } : m
                  )
                );
              }
              finalReceived = true;
            }
            return;
          }

          if (event.event === 'error') {
            const errorMessage =
              typeof parsed === 'object' && parsed && 'error' in parsed
                ? String((parsed as { error?: unknown }).error || '')
                : '';
            throw new Error(errorMessage || 'Streaming request failed.');
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (activeRequestIdRef.current !== requestId) {
            throw new DOMException('Request aborted', 'AbortError');
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

          let boundaryIndex = buffer.indexOf('\n\n');
          while (boundaryIndex !== -1) {
            const rawBlock = buffer.slice(0, boundaryIndex);
            buffer = buffer.slice(boundaryIndex + 2);
            const event = parseSseEventBlock(rawBlock);
            if (event) handleEvent(event);
            boundaryIndex = buffer.indexOf('\n\n');
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          const trailingEvent = parseSseEventBlock(buffer);
          if (trailingEvent) handleEvent(trailingEvent);
        }
      }

      if (!finalReceived) {
        console.warn('Analytics chat stream ended without a final event — keeping partial content.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;

      console.error('Analytics chat error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get response. Please try again.';
      toast.error(message);

      // Remove the empty assistant message but keep the user message
      setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
    } finally {
      if (activeRequestIdRef.current === requestId) {
        abortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [courseId, input, isLoading, messages]);

  return { messages, input, setInput, isLoading, handleSend, stopGenerating, clearChat };
}
