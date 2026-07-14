import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable fake that resolves to `result` from any awaited point in a
// Supabase query-builder chain (e.g. .from().select().eq().order()).
function createQueryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'in', 'order', 'delete', 'maybeSingle', 'single', 'insert'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const emptyResult = { data: [], error: null };

const authGetUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }));
const authGetSession = vi.fn(async () => ({
  data: { session: { access_token: 'token-123' } },
  error: null,
}));
const rpc = vi.fn(async () => emptyResult);
const from = vi.fn(() => createQueryChain(emptyResult));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: (...args: unknown[]) => authGetUser(...args),
      getSession: (...args: unknown[]) => authGetSession(...args),
    },
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    storage: { from: vi.fn() },
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from 'sonner';
import { useStudentChat } from './useStudentChat';

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(body: string, init?: Partial<Response>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

describe('useStudentChat', () => {
  beforeEach(() => {
    authGetUser.mockClear();
    authGetSession.mockClear();
    rpc.mockClear();
    from.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${Math.random()}`) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function setupWithCourse() {
    from.mockImplementation((table: string) => {
      if (table === 'materials') {
        return createQueryChain({ data: [], error: null });
      }
      return createQueryChain(emptyResult);
    });
    rpc.mockResolvedValueOnce({
      data: [{ id: 'course-1', name: 'Course 1', code: 'C1', access_role: 'student' }],
      error: null,
    });

    const { result } = renderHook(() => useStudentChat(null));

    await waitFor(() => {
      expect(result.current.selectedCourseId).toBe('course-1');
    });

    return result;
  }

  it('does not send an empty or whitespace-only message', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);

    act(() => {
      result.current.setInput('   ');
    });
    await act(async () => {
      await result.current.handleSend();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams token events and assembles the final answer with citations', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);

    const body =
      sseEvent('token', { text: 'Hel' }) +
      sseEvent('token', { text: 'lo' }) +
      sseEvent('final', {
        answer: 'Hello world',
        citations: [{ id: 'c1', chunkId: 'chunk-1', excerpt: 'x', documentName: 'doc', documentType: 'pdf', relevanceScore: 0.9 }],
        conversationId: 'conv-1',
      });
    fetchMock.mockResolvedValueOnce(streamResponse(body));

    act(() => {
      result.current.setInput('What is X?');
    });
    await act(async () => {
      await result.current.handleSend();
    });

    await waitFor(() => {
      const assistantMessage = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistantMessage?.content).toBe('Hello world');
    });

    const assistantMessage = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistantMessage?.citations).toHaveLength(1);
    expect(result.current.messages.find((m) => m.role === 'user')?.content).toBe('What is X?');
    expect(result.current.isLoading).toBe(false);
  });

  it('sends the current model tier and course id in the request body', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      streamResponse(sseEvent('final', { answer: 'ok', citations: [], conversationId: 'conv-1' }))
    );

    act(() => {
      result.current.setSelectedModel('pro');
      result.current.setInput('question');
    });
    await act(async () => {
      await result.current.handleSend();
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(String(requestInit?.body));
    expect(sentBody.model).toBe('pro');
    expect(sentBody.courseId).toBe('course-1');
  });

  it('surfaces a server error event as a toast and removes the empty assistant message', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      streamResponse(sseEvent('error', { error: 'Something broke' }))
    );

    act(() => {
      result.current.setInput('question');
    });
    await act(async () => {
      await result.current.handleSend();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Something broke');
    });
    expect(result.current.messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces a non-OK HTTP response as a toast error', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 })
    );

    act(() => {
      result.current.setInput('question');
    });
    await act(async () => {
      await result.current.handleSend();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Rate limit exceeded');
    });
  });

  it('keeps partial streamed content when the stream ends without a final event', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(streamResponse(sseEvent('token', { text: 'partial answer' })));

    act(() => {
      result.current.setInput('question');
    });
    await act(async () => {
      await result.current.handleSend();
    });

    await waitFor(() => {
      const assistantMessage = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistantMessage?.content).toBe('partial answer');
    });
  });

  it('stopGenerating aborts the request and drops an empty assistant placeholder', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);

    let rejectFetch: (reason: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFetch = reject;
        })
    );

    act(() => {
      result.current.setInput('question');
    });
    act(() => {
      void result.current.handleSend();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    act(() => {
      result.current.stopGenerating();
      rejectFetch(new DOMException('Request aborted', 'AbortError'));
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.messages.some((m) => m.role === 'assistant' && m.content === '')).toBe(false);
  });
});
