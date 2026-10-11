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
const from = vi.fn((_table: string) => createQueryChain(emptyResult));
const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://storage.test/notes.pdf' }, error: null }));
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
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${Math.random()}`) });
    localStorage.clear();
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

  it("records where a cited PDF lives so the reader can download it itself", async () => {
    from.mockImplementation((table: string) => {
      if (table === 'chunks') return createQueryChain({ data: { material_id: 'mat-1', student_document_id: null }, error: null });
      if (table === 'materials') {
        return createQueryChain({
          data: { file_path: 'course/lecture7.pdf', file_type: 'pdf', file_name: 'Lecture 7.pdf', linked_url: null, thumbnail_path: null },
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
        linked_url: null, thumbnail_path: null,
      }, error: null });
      return createQueryChain(emptyResult);
    });
    const citation = { id: 'c1', chunkId: 'chunk-1', excerpt: 'Relevant passage',
      documentName: 'Notes', documentType: 'pdf', relevanceScore: 0.9, startMs: 40_000, endMs: 45_000 };

    await act(async () => { await result.current.openCitationSource(citation, 'm1-1'); });
    expect(result.current.activeViewerSource?.documentName).toBe('Notes');
    expect(storageFrom).toHaveBeenCalledTimes(1);

    type = 'video';
    await act(async () => { await result.current.openCitationSource({ ...citation, documentType: 'video' }, 'm1-2'); });
    expect(result.current.activeViewerSource).toBeNull();
    expect(result.current.activeVideoSource).toMatchObject({
      title: 'Lecture', materialId: 'mat-1', filePath: 'course/lecture.mp4', startMs: 40_000,
    });
    expect(storageFrom).toHaveBeenCalledTimes(1);
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
