import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchQuestionBuckets: vi.fn(),
  fetchQuestions: vi.fn(),
  labelQuestions: vi.fn(),
  matchKeyword: vi.fn(),
}));
vi.mock('./analyticsApi', () => api);

import { NO_FILTERS, type TopicFilter } from './questionFilters';
import { useLoader } from './useLoader';
import { QUESTIONS_PER_PAGE, useQuestionFeed } from './useQuestionFeed';
import { useQuestionLabels, MAX_LABEL_ROUNDS } from './useQuestionLabels';
import { useTopicSearch } from './useTopicSearch';

const COURSE = 'course-1';
const RANGE = { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-24T00:00:00.000Z' };

const question = (id: string) => ({ id, queryText: id, createdAt: '', category: 'other', isStudyQuestion: true, answeredFromMaterials: true, needsAttention: false, sources: [] });

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
});

describe('useLoader', () => {
  it('loads for a key, reloads when the key changes and clears for no key', async () => {
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const { result, rerender } = renderHook(({ key }) => useLoader(key, load), { initialProps: { key: 'a' as string | null } });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe('first'));

    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.data).toBe('second'));
    rerender({ key: 'b' });
    expect(load).toHaveBeenCalledTimes(2);

    rerender({ key: null });
    expect(result.current).toEqual({ data: null, isLoading: false, error: null });
  });

  it('reports errors and ignores a stale response', async () => {
    let resolveSlow: (value: string) => void = () => {};
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveSlow = resolve; }))
      .mockRejectedValueOnce(new Error('Access denied'));
    const { result, rerender } = renderHook(({ key }) => useLoader(key, load), { initialProps: { key: 'slow' } });
    rerender({ key: 'fails' });
    await waitFor(() => expect(result.current.error).toBe('Access denied'));
    await act(async () => resolveSlow('stale'));
    expect(result.current.data).toBeNull();
  });
});

describe('useQuestionFeed', () => {
  it('loads the first page for the filters and appends more', async () => {
    const filters = { ...NO_FILTERS, needsAttention: true };
    api.fetchQuestions
      .mockResolvedValueOnce({ totalCount: 30, studentCount: 4, questions: [question('q1'), question('q2')] })
      .mockResolvedValueOnce({ totalCount: 30, studentCount: 4, questions: [question('q3')] });
    const { result } = renderHook(() => useQuestionFeed(COURSE, RANGE, filters, 0));

    await waitFor(() => expect(result.current.questions).toHaveLength(2));
    expect(api.fetchQuestions).toHaveBeenCalledWith(COURSE, RANGE, filters, { limit: QUESTIONS_PER_PAGE, offset: 0 });
    expect(result.current).toMatchObject({ totalCount: 30, studentCount: 4, hasMore: true });

    await act(() => result.current.loadMore());
    expect(api.fetchQuestions).toHaveBeenLastCalledWith(COURSE, RANGE, filters, { limit: QUESTIONS_PER_PAGE, offset: 2 });
    expect(result.current.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('starts over when the filters or labels change', async () => {
    api.fetchQuestions.mockResolvedValue({ totalCount: 1, studentCount: 1, questions: [question('q1')] });
    const { result, rerender } = renderHook(({ filters, version }) => useQuestionFeed(COURSE, RANGE, filters, version), {
      initialProps: { filters: NO_FILTERS, version: 0 },
    });
    await waitFor(() => expect(result.current.questions).toHaveLength(1));
    expect(result.current.hasMore).toBe(false);

    rerender({ filters: { ...NO_FILTERS, category: 'comparison' }, version: 0 });
    await waitFor(() => expect(api.fetchQuestions).toHaveBeenCalledTimes(2));
    rerender({ filters: { ...NO_FILTERS, category: 'comparison' }, version: 1 });
    await waitFor(() => expect(api.fetchQuestions).toHaveBeenCalledTimes(3));
    rerender({ filters: { ...NO_FILTERS, category: 'comparison' }, version: 1 });
    expect(api.fetchQuestions).toHaveBeenCalledTimes(3);
  });

  it('shows errors, and nothing without a course or window', async () => {
    api.fetchQuestions.mockRejectedValue(new Error('Access denied'));
    const { result, rerender } = renderHook(({ range }) => useQuestionFeed(COURSE, range, NO_FILTERS, 0), {
      initialProps: { range: null as typeof RANGE | null },
    });
    expect(result.current.questions).toEqual([]);
    expect(api.fetchQuestions).not.toHaveBeenCalled();
    rerender({ range: RANGE });
    await waitFor(() => expect(result.current.error).toBe('Access denied'));
  });
});

describe('useTopicSearch', () => {
  it('finds the topic in the materials and sets it with the matched places', async () => {
    const onTopic = vi.fn<(topic: TopicFilter | null) => void>();
    api.matchKeyword.mockResolvedValue([
      { key: 'm1:page:2', materialId: 'm1', fileName: 'A.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null, similarity: 0.5, snippet: '', chunkCount: 1 },
    ]);
    const { result } = renderHook(() => useTopicSearch(COURSE, onTopic));
    act(() => result.current.setInput('  hashing '));
    await act(() => result.current.submit());

    expect(api.matchKeyword).toHaveBeenCalledWith(COURSE, 'hashing');
    expect(onTopic).toHaveBeenCalledWith({ text: 'hashing', places: [{ material_id: 'm1', page_number: 2 }], source: 'search' });
    expect(result.current.note).toBeNull();
  });

  it('falls back to matching question text when the materials search fails', async () => {
    const onTopic = vi.fn();
    api.matchKeyword.mockRejectedValue(new Error('OpenAI is down'));
    const { result } = renderHook(() => useTopicSearch(COURSE, onTopic));
    act(() => result.current.setInput('hashing'));
    await act(() => result.current.submit());

    expect(onTopic).toHaveBeenCalledWith({ text: 'hashing', places: null, source: 'search' });
    expect(result.current.note).toMatch(/OpenAI is down/);
  });

  it('clears the topic for a blank search', async () => {
    const onTopic = vi.fn();
    const { result } = renderHook(() => useTopicSearch(COURSE, onTopic));
    await act(() => result.current.submit());
    expect(onTopic).toHaveBeenCalledWith(null);
    expect(api.matchKeyword).not.toHaveBeenCalled();
  });
});

describe('useQuestionLabels', () => {
  it('shows buckets, labels in rounds until done, then reloads the buckets', async () => {
    api.fetchQuestionBuckets.mockResolvedValue([{ category: 'other', questionCount: 3 }]);
    api.labelQuestions
      .mockResolvedValueOnce({ labeled: 25, failed: 0, remaining: 5 })
      .mockResolvedValueOnce({ labeled: 5, failed: 0, remaining: 0 });
    const { result } = renderHook(() => useQuestionLabels(COURSE, RANGE));

    await waitFor(() => expect(result.current.isLabelling).toBe(false));
    expect(api.labelQuestions).toHaveBeenCalledTimes(2);
    expect(api.labelQuestions).toHaveBeenCalledWith(COURSE, RANGE);
    expect(api.fetchQuestionBuckets).toHaveBeenCalledTimes(2);
    expect(result.current.buckets).toEqual([{ category: 'other', questionCount: 3 }]);
    expect(result.current.remaining).toBe(0);
    expect(result.current.labelError).toBeNull();
    expect(result.current.version).toBe(1);
  });

  it('stops when a round makes no progress and keeps the error', async () => {
    api.fetchQuestionBuckets.mockResolvedValue([]);
    api.labelQuestions.mockResolvedValue({ labeled: 0, failed: 2, remaining: 2, error: 'Decisions API error (403): not enabled' });
    const { result } = renderHook(() => useQuestionLabels(COURSE, RANGE));

    await waitFor(() => expect(result.current.labelError).toBe('Decisions API error (403): not enabled'));
    expect(api.labelQuestions).toHaveBeenCalledTimes(1);
    expect(result.current.remaining).toBe(2);
    expect(result.current.version).toBe(0);
  });

  it(`gives up after ${MAX_LABEL_ROUNDS} rounds`, async () => {
    api.fetchQuestionBuckets.mockResolvedValue([]);
    api.labelQuestions.mockResolvedValue({ labeled: 25, failed: 0, remaining: 1000 });
    const { result } = renderHook(() => useQuestionLabels(COURSE, RANGE));
    await waitFor(() => expect(result.current.isLabelling).toBe(false));
    expect(api.labelQuestions).toHaveBeenCalledTimes(MAX_LABEL_ROUNDS);
  });

  it('reports a failed labelling call without losing the buckets', async () => {
    api.fetchQuestionBuckets.mockResolvedValue([{ category: 'other', questionCount: 1 }]);
    api.labelQuestions.mockRejectedValue(new Error('Failed to send a request'));
    const { result } = renderHook(() => useQuestionLabels(COURSE, RANGE));
    await waitFor(() => expect(result.current.labelError).toBe('Failed to send a request'));
    expect(result.current.buckets).toEqual([{ category: 'other', questionCount: 1 }]);
  });
});
