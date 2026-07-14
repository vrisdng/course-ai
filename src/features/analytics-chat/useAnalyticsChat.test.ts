import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: mocks.getSession } } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

import { useAnalyticsChat } from './useAnalyticsChat';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('useAnalyticsChat', () => {
  let nextId: number;
  beforeEach(() => {
    nextId = 0;
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    mocks.toastError.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${++nextId}`) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('guards empty messages and requires a selected course', async () => {
    const { result } = renderHook(() => useAnalyticsChat(null, null, null));
    await act(async () => result.current.handleSend());
    expect(fetch).not.toHaveBeenCalled();
    act(() => result.current.setInput('Question'));
    await act(async () => result.current.handleSend());
    expect(mocks.toastError).toHaveBeenCalledWith('Select a course first');
  });

  it('sends filters and renders a JSON answer', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ answer: '42 students' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const { result } = renderHook(() => useAnalyticsChat('course-1', '2026-01-01', '2026-02-01'));
    act(() => result.current.setInput('  How many?  '));
    await act(async () => result.current.handleSend());
    expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'How many?' }, { role: 'assistant', content: '42 students' },
    ]);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer token', 'Content-Type': 'application/json' }));
    expect(JSON.parse(String(init?.body))).toEqual({
      message: 'How many?', courseId: 'course-1', history: [], startAt: '2026-01-01', endAt: '2026-02-01',
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('assembles split SSE tokens and lets the final answer replace partial text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(streamResponse([
      ': keepalive\r\nevent: token\r\ndata: {"text":"par',
      'tial"}\r\n\r\nevent: final\ndata: {"answer":"complete"}',
    ]));
    const { result } = renderHook(() => useAnalyticsChat('course-1', null, null));
    act(() => result.current.setInput('Question'));
    await act(async () => result.current.handleSend());
    expect(result.current.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'complete' });
  });

  it('keeps a partial answer when a stream ends without a final event', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(streamResponse(['event: token\ndata: {"text":"partial"}\n\n']));
    const { result } = renderHook(() => useAnalyticsChat('course-1', null, null));
    act(() => result.current.setInput('Question'));
    await act(async () => result.current.handleSend());
    expect(result.current.messages.at(-1)?.content).toBe('partial');
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it('surfaces session, HTTP, and streamed application errors while retaining the question', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const { result } = renderHook(() => useAnalyticsChat('course-1', null, null));
    act(() => result.current.setInput('First'));
    await act(async () => result.current.handleSend());
    expect(mocks.toastError).toHaveBeenLastCalledWith(expect.stringContaining('session has expired'));
    expect(result.current.messages).toHaveLength(1);

    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"error":"Rate limited"}', { status: 429 }));
    act(() => result.current.setInput('Second'));
    await act(async () => result.current.handleSend());
    expect(mocks.toastError).toHaveBeenLastCalledWith('Rate limited');

    vi.mocked(fetch).mockResolvedValueOnce(streamResponse(['event: error\ndata: {"error":"Query failed"}\n\n']));
    act(() => result.current.setInput('Third'));
    await act(async () => result.current.handleSend());
    expect(mocks.toastError).toHaveBeenLastCalledWith('Query failed');
    expect(result.current.messages.every((message) => message.role === 'user')).toBe(true);
    consoleError.mockRestore();
  });

  it('stops an active request and clears chat state', async () => {
    let rejectFetch!: (reason: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((_, reject) => { rejectFetch = reject; }));
    const { result } = renderHook(() => useAnalyticsChat('course-1', null, null));
    act(() => result.current.setInput('Question'));
    act(() => { void result.current.handleSend(); });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    act(() => { result.current.stopGenerating(); rejectFetch(new DOMException('aborted', 'AbortError')); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.clearChat());
    expect(result.current.messages).toEqual([]);
  });

  it('resets messages and input when the reporting scope changes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ answer: 'answer' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const { result, rerender } = renderHook(
      ({ course }) => useAnalyticsChat(course, null, null), { initialProps: { course: 'course-1' } },
    );
    act(() => result.current.setInput('Question'));
    await act(async () => result.current.handleSend());
    expect(result.current.messages).not.toEqual([]);
    rerender({ course: 'course-2' });
    expect(result.current.messages).toEqual([]);
    expect(result.current.input).toBe('');
  });
});
