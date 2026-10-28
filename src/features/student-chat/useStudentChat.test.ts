import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable fake that resolves to `result` from any awaited point in a
// Supabase query-builder chain (e.g. .from().select().eq().order()).
function createQueryChain(result: { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'in', 'order', 'delete', 'maybeSingle', 'single', 'insert'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: Awaited<typeof result>) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const emptyResult = { data: [], error: null };

const authGetUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }));
const authGetSession = vi.fn(async () => ({
  data: { session: { access_token: 'token-123' } },
  error: null,
}));
const rpc = vi.fn(async () => emptyResult);
const from = vi.fn((_table: string) => createQueryChain(emptyResult));
const createSignedUrl = vi.fn(async (_path: string) => ({ data: { signedUrl: 'https://storage.test/notes.pdf' }, error: null }));
const storageFrom = vi.fn((_bucket: string) => ({ createSignedUrl }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: (...args: unknown[]) => authGetUser(...args),
      getSession: (...args: unknown[]) => authGetSession(...args),
    },
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    storage: { from: (bucket: string) => storageFrom(bucket) },
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const signedMediaMocks = vi.hoisted(() => ({ prefetchSignedMediaUrl: vi.fn() }));
vi.mock('./signedMedia', () => ({
  prefetchSignedMediaUrl: signedMediaMocks.prefetchSignedMediaUrl,
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
    storageFrom.mockClear();
    createSignedUrl.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    signedMediaMocks.prefetchSignedMediaUrl.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${Math.random()}`) });
    try { window.localStorage.clear(); } catch { /* jsdom storage may be unavailable */ }
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
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

  it.each(['stream', 'json'] as const)(
    'preserves the first long exchange when the %s final conversation ID is discovered',
    async (format) => {
      const result = await setupWithCourse();
      const conversation = { id: 'new-conversation', title: 'First question', created_at: '2026-10-28', course_id: 'course-1' };
      let resolveList!: (value: { data: unknown; error: unknown }) => void;
      const pendingList = new Promise<{ data: unknown; error: unknown }>((resolve) => { resolveList = resolve; });
      from.mockImplementation((table: string) => createQueryChain(table === 'conversations' ? pendingList : emptyResult));
      const answer = 'A detailed answer. '.repeat(1000);
      const citations = [{ id: 'cite-1', chunkId: 'chunk-1', excerpt: 'Evidence', documentName: 'Lecture', documentType: 'pdf', relevanceScore: 0.9 }];
      const payload = { answer, citations, conversationId: conversation.id };
      vi.mocked(fetch).mockResolvedValueOnce(format === 'stream'
        ? streamResponse(sseEvent('final', payload))
        : new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }));
      act(() => result.current.setInput('A long first question. '.repeat(100)));
      let sending!: Promise<void>;
      act(() => { sending = result.current.handleSend(); });
      await waitFor(() => expect(result.current.messages[1]?.content).toBe(answer));
      const originalMessages = result.current.messages;
      act(() => result.current.openSourcesForMessage(originalMessages[1]));
      await act(async () => {
        resolveList({ data: [conversation], error: null });
        await sending;
      });

      expect(result.current.messages).toBe(originalMessages);
      expect(result.current.selectedMessage).toBe(originalMessages[1]);
      expect(result.current.currentConversationId).toBe(conversation.id);
      expect(result.current.conversations).toHaveLength(1);
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1]).toMatchObject({ content: answer, citations });
      // Reloading history remounts the messages and loses their stable in-memory IDs.
      expect(from).not.toHaveBeenCalledWith('messages');
      const messageIds = result.current.messages.map((message) => message.id);
      act(() => result.current.setInput('Follow-up'));
      vi.mocked(fetch).mockResolvedValueOnce(streamResponse(sseEvent('final', payload)));
      await act(async () => { await result.current.handleSend(); });
      expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).conversationId).toBe(conversation.id);
      expect(result.current.messages.slice(0, 2).map((message) => message.id)).toEqual(messageIds);
    },
  );

  it('ignores a final conversation-list refresh after starting another chat', async () => {
    const result = await setupWithCourse();
    let resolveList!: (value: { data: unknown; error: unknown }) => void;
    const pendingList = new Promise<{ data: unknown; error: unknown }>((resolve) => { resolveList = resolve; });
    from.mockImplementation((table: string) => createQueryChain(table === 'conversations' ? pendingList : emptyResult));
    from.mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(streamResponse(sseEvent('final', {
      answer: 'Final answer', citations: [], conversationId: 'old-conversation',
    })));
    act(() => result.current.setInput('question'));
    let sending!: Promise<void>;
    act(() => { sending = result.current.handleSend(); });
    await waitFor(() => expect(from).toHaveBeenCalledWith('conversations'));
    act(() => result.current.startNewConversation());
    await act(async () => {
      resolveList({ data: [{ id: 'old-conversation', title: 'Old', created_at: '2026-10-28', course_id: 'course-1' }], error: null });
      await sending;
    });
    expect(result.current.currentConversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.conversations).toEqual([]);
  });

  it('ignores history hydration that finishes after navigation', async () => {
    let resolveCitations!: (value: { data: unknown; error: unknown }) => void;
    const pendingCitations = new Promise<{ data: unknown; error: unknown }>((resolve) => { resolveCitations = resolve; });
    from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        const chain = createQueryChain({ data: [{ id: 'conv-1', title: 'Old', created_at: '2026-10-28', course_id: 'course-1' }], error: null });
        chain.maybeSingle = vi.fn(async () => ({ data: { id: 'conv-1' }, error: null }));
        return chain;
      }
      if (table === 'messages') return createQueryChain({ data: [{ id: 'stored-message', role: 'assistant', content: 'Old answer' }], error: null });
      if (table === 'citations') return createQueryChain(pendingCitations);
      return createQueryChain(emptyResult);
    });
    const { result, rerender } = renderHook(({ routeId }: { routeId: string | null }) => useStudentChat(routeId), { initialProps: { routeId: 'conv-1' } });
    await waitFor(() => expect(from).toHaveBeenCalledWith('citations'));
    rerender({ routeId: null });
    await act(async () => { resolveCitations(emptyResult); });
    expect(result.current.currentConversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it('aborts an active stream on route navigation and ignores its late final answer', async () => {
    const { result, rerender } = renderHook(({ routeId }: { routeId: string | null }) => useStudentChat(routeId), { initialProps: { routeId: null } });
    act(() => result.current.changeSelectedCourse('course-1'));
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    act(() => result.current.setInput('question'));
    let sending!: Promise<void>;
    act(() => { sending = result.current.handleSend(); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ routeId: 'other-conversation' });
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => {
      controller.enqueue(new TextEncoder().encode(sseEvent('final', { answer: 'Late answer', citations: [], conversationId: 'old-conversation' })));
      controller.close();
      await sending;
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(toast.error).not.toHaveBeenCalledWith('Streaming request failed.');
  });

  it.each(['individual', 'all'] as const)('sends selected IDs for a comparison using %s selection', async (selection) => {
    const docs = [1, 2, 3].map((n) => ({ id: `doc-${n}`, file_name: `Notes ${n}`, file_type: 'pdf' }));
    from.mockImplementation((table: string) => createQueryChain(table === 'materials' ? { data: docs, error: null } : emptyResult));
    rpc.mockResolvedValueOnce({ data: [{ id: 'course-1', name: 'Course', code: 'C1', access_role: 'student' }], error: null });
    const { result } = renderHook(() => useStudentChat(null));
    await waitFor(() => expect(result.current.selectedDocumentIds).toHaveLength(3));
    act(() => {
      result.current.clearSelectedDocuments();
    });
    act(() => {
      if (selection === 'all') result.current.selectAllDocuments();
      else result.current.applySelectedDocuments(['doc-1', 'doc-2']);
      result.current.setInput('Compare these materials');
    });
    vi.mocked(fetch).mockResolvedValueOnce(streamResponse(sseEvent('final', { answer: 'Comparison', citations: [], conversationId: 'conv-1' })));
    await act(async () => { await result.current.handleSend(); });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.selectedDocumentIds).toEqual(selection === 'all' ? ['doc-1', 'doc-2', 'doc-3'] : ['doc-1', 'doc-2']);
    expect(body.skipRag).toBe(false);
  });

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

  it('records final receipt, React commit and EOF only when chat timing is enabled', async () => {
    window.history.replaceState({}, '', '/?perf=chat');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await setupWithCourse();
    act(() => result.current.setInput('private question'));
    vi.mocked(fetch).mockResolvedValueOnce(streamResponse(
      sseEvent('token', { text: 'private partial' }) + sseEvent('final', {
        answer: 'private answer', citations: [], conversationId: 'conv-1', meta: { requestId: 'req-1' },
      }) + sseEvent('ready', {}),
    ));
    await act(async () => { await result.current.handleSend(); });
    const samples = log.mock.calls.map((call) => call[1]);
    expect(samples).toEqual(expect.arrayContaining([
      expect.objectContaining({ request_id: 'req-1', first_token_received_ms: expect.any(Number) }),
      expect.objectContaining({ request_id: 'req-1', final_received_ms: expect.any(Number) }),
      expect.objectContaining({ request_id: 'req-1', ready_received_ms: expect.any(Number) }),
      expect.objectContaining({ request_id: 'req-1', final_commit_ms: expect.any(Number) }),
      expect.objectContaining({ request_id: 'req-1', eof_ms: expect.any(Number) }),
    ]));
    expect(JSON.stringify(samples)).not.toContain('private');
  });

  it('streams token events and assembles the final answer with citations', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);

    const body =
      sseEvent('token', { text: 'Hel' }) +
      sseEvent('token', { text: 'lo' }) +
      sseEvent('final', {
        answer: 'Hello world',
        citations: [{ id: 'c1', chunkId: 'chunk-1', excerpt: 'x', documentName: 'video', documentType: 'video', relevanceScore: 0.9,
          evidenceSegments: [{ id: 'segment-1', segmentIndex: 1, startMs: 1000, endMs: 2000, text: 'Evidence.' }] }],
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
    expect(assistantMessage?.citations?.[0].evidenceSegments?.[0].id).toBe('segment-1');
    expect(result.current.messages.find((m) => m.role === 'user')?.content).toBe('What is X?');
    expect(result.current.isLoading).toBe(false);
  });

  it.each(['close', 'error'] as const)(
    'displays the final answer before the stream ends with %s, keeping follow-ups blocked until then',
    async (ending) => {
      const result = await setupWithCourse();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(value) { controller = value; },
        cancel,
      });
      vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
      }));
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => frames.push(callback)));
      const citations = [{
        id: 'c1', chunkId: 'chunk-1', excerpt: 'Evidence',
        documentName: 'Lecture', documentType: 'pdf', relevanceScore: 0.9,
      }];

      act(() => result.current.setInput('question'));
      let sending!: Promise<void>;
      act(() => { sending = result.current.handleSend(); });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const userLookups = authGetUser.mock.calls.length;

      try {
        act(() => controller.enqueue(new TextEncoder().encode(
          sseEvent('status', { message: 'Searching course materials' }) +
          sseEvent('token', { text: 'Unfinished draft' }) +
          sseEvent('final', { answer: 'Final cited answer', citations, conversationId: 'conv-1' }),
        )));

        await waitFor(() => {
          expect(result.current.messages.find((m) => m.role === 'assistant')).toMatchObject({
            content: 'Final cited answer', citations, status: undefined,
          });
        });
        act(() => frames.forEach((callback) => callback(0)));
        expect(result.current.messages.find((m) => m.role === 'assistant')?.content).toBe('Final cited answer');
        expect(result.current.isLoading).toBe(true);
        expect(authGetUser).toHaveBeenCalledTimes(userLookups);

        act(() => result.current.setInput('follow-up'));
        await act(async () => { await result.current.handleSend(); });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
        expect(cancel).not.toHaveBeenCalled();
      } finally {
        await act(async () => {
          if (ending === 'error') controller.error(new TypeError('Stream connection lost'));
          else controller.close();
          await sending;
        });
      }

      expect(result.current.messages.find((m) => m.role === 'assistant')).toMatchObject({
        content: 'Final cited answer', citations,
      });
      expect(result.current.isLoading).toBe(false);
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it.each(['pdf', 'video'])('unlocks a saved %s turn before EOF and sends follow-ups to its conversation', async (documentType) => {
    const result = await setupWithCourse();
    from.mockImplementation((table) => createQueryChain(table === 'conversations' ? {
      data: [{ id: 'conv-1', title: 'Question', course_id: 'course-1', created_at: '2026-10-28' }], error: null,
    } : emptyResult));
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
      start(value) { controller = value; },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const citation = { id: 'c1', chunkId: 'chunk', materialId: 'material', excerpt: 'Evidence',
      documentName: 'Lecture', documentType, relevanceScore: 0.9, startMs: 1000, endMs: 5000 };
    act(() => result.current.setInput('question'));
    let sending!: Promise<void>;
    act(() => { sending = result.current.handleSend(); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const emit = (event: string, data: unknown) => controller.enqueue(new TextEncoder().encode(sseEvent(event, data)));
    try {
      act(() => emit('final', { answer: 'Answer <<cite:1>>', citations: [citation], conversationId: 'conv-1' }));
      await waitFor(() => expect(result.current.messages[1]?.content).toBe('Answer <<cite:1>>'));
      expect(result.current.isLoading).toBe(true);
      act(() => emit('ready', {}));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.currentConversationId).toBe('conv-1');
      expect(result.current.messages).toHaveLength(2);
      if (documentType === 'video') {
        const evidenceSegments = [{ id: 'segment', segmentIndex: 0, startMs: 1000, endMs: 2000, text: 'Evidence' }];
        act(() => result.current.openSourcesForMessage(result.current.messages[1]));
        act(() => emit('citations', { citations: [{ ...citation, evidenceSegments }, { ...citation, id: 'other' }] }));
        await waitFor(() => expect(result.current.messages[1].citations?.[0].evidenceSegments).toEqual(evidenceSegments));
        expect(result.current.selectedMessage?.citations?.[0].evidenceSegments).toEqual(evidenceSegments);
        expect(result.current.selectedMessage?.citations).toHaveLength(1);
      }
      let finishFollowup!: ReadableStreamDefaultController<Uint8Array>;
      vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ start(value) { finishFollowup = value; } }), {
        headers: { 'content-type': 'text/event-stream' },
      }));
      act(() => result.current.setInput('follow-up'));
      let followup!: Promise<void>;
      act(() => { followup = result.current.handleSend(); });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).conversationId).toBe('conv-1');
      expect(vi.mocked(fetch).mock.calls[0][1]!.signal!.aborted).toBe(true);
      await act(async () => {
        emit('citations', { citations: [] });
        controller.close();
        await sending;
      });
      expect(result.current.isLoading).toBe(true);
      expect(result.current.messages[1].citations).toHaveLength(documentType === 'video' ? 2 : 1);
      await act(async () => { finishFollowup.close(); await followup; });
    } finally {
      try { controller.close(); } catch { /* already closed */ }
      await act(async () => { await sending; });
    }
  });

  it('keeps a saved answer usable when the background conversation refresh rejects', async () => {
    const result = await setupWithCourse();
    const error = new Error('Network unavailable');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    authGetUser.mockRejectedValueOnce(error);
    vi.mocked(fetch).mockResolvedValueOnce(streamResponse(
      sseEvent('final', { answer: 'Saved answer', citations: [], conversationId: 'conv-1' }) +
      sseEvent('ready', {}),
    ));
    act(() => result.current.setInput('question'));
    await act(async () => { await result.current.handleSend(); });
    expect(warning).toHaveBeenCalledWith('Failed to refresh conversations after saving the answer:', error);
    expect(result.current.messages[1].content).toBe('Saved answer');
    expect(result.current.currentConversationId).toBe('conv-1');
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces persistence failure without removing the completed answer', async () => {
    const result = await setupWithCourse();
    vi.mocked(fetch).mockResolvedValueOnce(streamResponse(
      sseEvent('final', { answer: 'Completed answer', citations: [], conversationId: 'conv-1' }) +
      sseEvent('error', { code: 'message_persistence_failed', error: 'Your answer could not be saved.' }),
    ));
    act(() => result.current.setInput('question'));
    await act(async () => { await result.current.handleSend(); });
    expect(result.current.messages[1].content).toBe('Completed answer');
    expect(toast.error).toHaveBeenCalledWith('Your answer could not be saved.');
    expect(result.current.isLoading).toBe(false);
  });

  it('displays a final answer returned as JSON', async () => {
    const result = await setupWithCourse();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      answer: 'JSON answer', citations: [], conversationId: 'conv-1',
    }), { headers: { 'content-type': 'application/json' } }));

    act(() => result.current.setInput('question'));
    await act(async () => { await result.current.handleSend(); });

    expect(result.current.messages.find((m) => m.role === 'assistant')).toMatchObject({
      content: 'JSON answer', citations: [], status: undefined,
    });
  });

  it('shows search status, discards text from before a search, and clears the status on the final answer', async () => {
    const result = await setupWithCourse();
    const fetchMock = vi.mocked(fetch);
    const searching = 'Searching course materials for "tombstones"';

    fetchMock.mockResolvedValueOnce(
      streamResponse(
        sseEvent('token', { text: 'Let me look that up. ' }) +
          sseEvent('reset', {}) +
          sseEvent('status', { message: searching }) +
          sseEvent('token', { text: 'Tombstones mark deleted slots.' }),
      ),
    );
    act(() => result.current.setInput('Why tombstones?'));
    await act(async () => {
      await result.current.handleSend();
    });
    await waitFor(() => {
      const assistant = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe('Tombstones mark deleted slots.');
      expect(assistant?.status).toBe(searching);
    });

    fetchMock.mockResolvedValueOnce(
      streamResponse(
        sseEvent('status', { message: searching }) +
          sseEvent('final', { answer: 'Final answer', citations: [], conversationId: 'conv-1' }),
      ),
    );
    act(() => result.current.setInput('Again?'));
    await act(async () => {
      await result.current.handleSend();
    });
    await waitFor(() => {
      const assistant = [...result.current.messages].reverse().find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe('Final answer');
      expect(assistant?.status).toBeUndefined();
    });
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

  it('starts with the sources panel collapsed and exposes a boolean setter', () => {
    const { result } = renderHook(() => useStudentChat(null));
    expect(result.current.showSidePanel).toBe(false);
    expect(typeof result.current.setShowSidePanel).toBe('function');

    act(() => {
      result.current.setShowSidePanel(true);
    });
    expect(result.current.showSidePanel).toBe(true);
  });

  describe('opening a PDF citation', () => {
    const citation = {
      id: 'c1',
      chunkId: 'chunk-1',
      excerpt: 'Optimal substructure',
      documentName: 'Lecture 7',
      documentType: 'pdf',
      pageNumber: 4,
      relevanceScore: 0.9,
    };

    function mockTables(pageRow: { width: number; height: number } | null) {
      from.mockImplementation((table: string) => {
        if (table === 'chunks') {
          return createQueryChain({
            data: { material_id: 'mat-1', student_document_id: null, highlight_box: [0.1, 0.2, 0.6, 0.3] },
            error: null,
          });
        }
        if (table === 'materials') {
          return createQueryChain({
            data: { file_path: 'course/lecture7.pdf', file_type: 'pdf', file_name: 'Lecture 7.pdf', linked_url: null },
            error: null,
          });
        }
        if (table === 'material_pages') {
          return createQueryChain({ data: pageRow, error: null });
        }
        return createQueryChain(emptyResult);
      });
      createSignedUrl.mockImplementation(async (path: string) => ({
        data: { signedUrl: `https://signed.test/${path}` },
        error: null,
      }));
    }

    it('opens the rendered page image with the cited box', async () => {
      mockTables({ width: 1400, height: 788 });
      const { result } = renderHook(() => useStudentChat(null));

      await act(async () => {
        await result.current.openCitationSource(citation, 'key-1');
      });

      expect(result.current.showSidePanel).toBe(true);
      expect(result.current.activeViewerSource).toMatchObject({
        kind: 'pdf',
        pageNumber: 4,
        signedUrl: 'https://signed.test/course/lecture7.pdf',
        pageImage: { url: 'https://signed.test/page-images/mat-1/page-4.webp', width: 1400, height: 788 },
        highlightBoxes: [[0.1, 0.2, 0.6, 0.3]],
      });
    });

    it('boxes only the blocks the answer cited, on their page', async () => {
      mockTables({ width: 1400, height: 788 });
      const chunksAndMaterials = from.getMockImplementation()!;
      from.mockImplementation((table: string) =>
        table === 'page_blocks'
          ? createQueryChain({
              data: [
                { id: 'blk-2', page_number: 5, box: [0.1, 0.5, 0.9, 0.6] },
                { id: 'blk-1', page_number: 5, box: [0.1, 0.3, 0.9, 0.4] },
              ],
              error: null,
            })
          : chunksAndMaterials(table),
      );
      const { result } = renderHook(() => useStudentChat(null));

      await act(async () => {
        await result.current.openCitationSource({ ...citation, blockIds: ['blk-1', 'blk-2'] }, 'key-3');
      });

      expect(from).toHaveBeenCalledWith('page_blocks');
      expect(result.current.activeViewerSource).toMatchObject({
        kind: 'pdf',
        pageNumber: 5,
        pageImage: { url: 'https://signed.test/page-images/mat-1/page-5.webp' },
        highlightBoxes: [
          [0.1, 0.3, 0.9, 0.4],
          [0.1, 0.5, 0.9, 0.6],
        ],
      });
    });

    it('opens a converted PowerPoint citation as its PDF page image', async () => {
      mockTables({ width: 1400, height: 788 });
      from.mockImplementation((table: string) => {
        if (table === 'chunks') {
          return createQueryChain({
            data: { material_id: 'mat-2', student_document_id: null, highlight_box: [0.1, 0.2, 0.6, 0.3] },
            error: null,
          });
        }
        if (table === 'materials') {
          return createQueryChain({
            data: {
              file_path: 'course/deck.pptx',
              file_type: 'slides',
              file_name: 'Deck.pptx',
              linked_url: null,
              converted_pdf_path: 'converted/mat-2.pdf',
            },
            error: null,
          });
        }
        if (table === 'material_pages') {
          return createQueryChain({ data: { width: 1400, height: 788 }, error: null });
        }
        return createQueryChain(emptyResult);
      });
      const { result } = renderHook(() => useStudentChat(null));

      await act(async () => {
        await result.current.openCitationSource({ ...citation, documentType: 'slides', documentName: 'Deck.pptx' }, 'key-2');
      });

      expect(result.current.clearViewSource).toBeNull();
      expect(result.current.activeViewerSource).toMatchObject({
        kind: 'pdf',
        documentName: 'Deck.pptx',
        signedUrl: 'https://signed.test/converted/mat-2.pdf',
        pageImage: { url: 'https://signed.test/page-images/mat-2/page-4.webp' },
        highlightBoxes: [[0.1, 0.2, 0.6, 0.3]],
      });
    });

    it('falls back to the PDF without a highlight when the page was not rendered', async () => {
      mockTables(null);
      const { result } = renderHook(() => useStudentChat(null));

      await act(async () => {
        await result.current.openCitationSource(citation, 'key-1');
      });

      expect(result.current.activeViewerSource).toMatchObject({
        kind: 'pdf',
        signedUrl: 'https://signed.test/course/lecture7.pdf',
        pageImage: null,
        highlightBoxes: [],
      });
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  it("records where a cited PDF lives so the reader can download it itself", async () => {
    from.mockImplementation((table: string) => {
      if (table === 'chunks') return createQueryChain({ data: { material_id: 'mat-1', student_document_id: null }, error: null });
      if (table === 'materials') {
        return createQueryChain({
          data: { file_path: 'course/lecture7.pdf', file_type: 'pdf', file_name: 'Lecture 7.pdf', linked_url: null },
          error: null,
        });
      }
      return createQueryChain(emptyResult);
    });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.test/lecture7.pdf' }, error: null });
    const { result } = renderHook(() => useStudentChat(null));

    await act(async () => {
      await result.current.openCitationSource(
        { id: 'c1', chunkId: 'chunk-1', excerpt: 'x', documentName: 'Lecture 7.pdf', documentType: 'pdf', pageNumber: 4, relevanceScore: 1 },
        'key-1',
      );
    });

    expect(result.current.activeViewerSource).toMatchObject({
      kind: 'pdf',
      pageNumber: 4,
      storage: { bucket: 'course-materials', path: 'course/lecture7.pdf' },
    });
  });

  it('opens a stored video after a PDF without signing its R2 path through Supabase Storage', async () => {
    const result = await setupWithCourse();
    let type = 'pdf';
    from.mockImplementation((table: string) => {
      if (table === 'chunks') return createQueryChain({ data: { material_id: 'mat-1', student_document_id: null }, error: null });
      if (table === 'materials') return createQueryChain({ data: {
        file_path: type === 'video' ? 'course/lecture.mp4' : 'course/notes.pdf',
        file_type: type, file_name: type === 'video' ? 'Lecture' : 'Notes',
        linked_url: null,
      }, error: null });
      if (table === 'material_pages') return createQueryChain({ data: null, error: null });
      return createQueryChain(emptyResult);
    });
    const citation = { id: 'c1', chunkId: 'chunk-1', materialId: 'mat-1', excerpt: 'Relevant passage',
      documentName: 'Notes', documentType: 'pdf', relevanceScore: 0.9, startMs: 40_000, endMs: 45_000 };

    await act(async () => { await result.current.openCitationSource(citation, 'm1-1'); });
    expect(result.current.activeViewerSource?.documentName).toBe('Notes');
    expect(storageFrom).toHaveBeenCalledTimes(1);

    type = 'video';
    from.mockClear();
    signedMediaMocks.prefetchSignedMediaUrl.mockClear();
    await act(async () => { await result.current.openCitationSource({ ...citation, documentType: 'video' }, 'm1-2'); });
    expect(result.current.activeViewerSource).toBeNull();
    expect(result.current.activeVideoSource).toMatchObject({
      title: 'Lecture', materialId: 'mat-1', filePath: 'course/lecture.mp4', startMs: 40_000,
      signedUrl: null,
    });
    expect(storageFrom).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalledWith('chunks');
    expect(signedMediaMocks.prefetchSignedMediaUrl).toHaveBeenCalledWith('mat-1');
  });

  it('hydrates saved evidence after the cited chunk has been replaced', async () => {
    const evidence = [{ id: 'old-segment', segmentIndex: 1, startMs: 35_000, endMs: 42_000, text: 'Supporting line.' }];
    rpc.mockResolvedValueOnce({ data: [{ id: 'course-1', name: 'Course', code: 'C1', access_role: 'student' }], error: null });
    from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        const chain = createQueryChain({ data: [
          { id: 'conv-1', title: 'Lecture', created_at: '2026-10-09', course_id: 'course-1' },
        ], error: null });
        chain.maybeSingle = vi.fn(async () => ({ data: { id: 'conv-1' }, error: null }));
        return chain;
      }
      if (table === 'messages') return createQueryChain({ data: [
        { id: 'msg-1', role: 'assistant', content: 'Answer <<cite:1>>', created_at: '2026-10-09' },
      ], error: null });
      if (table === 'citations') return createQueryChain({ data: [
        { id: 'cite-1', message_id: 'msg-1', chunk_id: null, material_id: 'mat-1',
          student_document_id: null, page_number: null, start_ms: 30_000, end_ms: 50_000,
          relevance_score: 0.9, excerpt: 'Supporting line.', image_url: null, evidence_segments: evidence },
      ], error: null });
      if (table === 'materials') return createQueryChain({ data: [
        { id: 'mat-1', file_name: 'Lecture', file_type: 'video' },
      ], error: null });
      return createQueryChain(emptyResult);
    });

    const { result } = renderHook(() => useStudentChat('conv-1'));
    await waitFor(() => expect(result.current.messages[0]?.citations?.[0].evidenceSegments).toEqual(evidence));
    expect(result.current.messages[0].citations?.[0]).toMatchObject({
      chunkId: null, materialId: 'mat-1', startMs: 30_000, documentName: 'Lecture',
    });
  });
});
