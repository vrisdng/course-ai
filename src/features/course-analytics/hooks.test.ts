import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchCitedMaterials: vi.fn(),
  fetchCitedPlaces: vi.fn(),
  fetchQuestionBuckets: vi.fn(),
  fetchQuestionsAtPlaces: vi.fn(),
  labelQuestions: vi.fn(),
  matchKeyword: vi.fn(),
}));
vi.mock('./analyticsApi', () => api);

import { useCitedMaterials } from './useCitedMaterials';
import { useKeywordSearch } from './useKeywordSearch';
import { useQuestionLabels, MAX_LABEL_ROUNDS } from './useQuestionLabels';

const COURSE = 'course-1';
const RANGE = { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-24T00:00:00.000Z' };

const pdfPlace = {
  key: 'm1:page:3', materialId: 'm1', fileName: 'A.pdf', fileType: 'pdf',
  pageNumber: 3, startMs: null, endMs: null, similarity: 0.6, snippet: 's', chunkCount: 1,
};
const videoPlace = {
  key: 'v1:time:0-30000', materialId: 'v1', fileName: 'L.mp4', fileType: 'video',
  pageNumber: null, startMs: 0, endMs: 30000, similarity: 0.5, snippet: 's', chunkCount: 1,
};

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
});

describe('useCitedMaterials', () => {
  it('loads materials for the course and window, and places on expand', async () => {
    api.fetchCitedMaterials.mockResolvedValue([{ materialId: 'm1', fileName: 'A.pdf' }]);
    api.fetchCitedPlaces.mockResolvedValue([{ key: 'm1:page:3' }]);
    const { result } = renderHook(() => useCitedMaterials(COURSE, RANGE));

    await waitFor(() => expect(result.current.materials).toHaveLength(1));
    expect(api.fetchCitedMaterials).toHaveBeenCalledWith(COURSE, RANGE);

    act(() => result.current.toggleMaterial('m1'));
    await waitFor(() => expect(result.current.expanded.m1?.places).toEqual([{ key: 'm1:page:3' }]));
    expect(api.fetchCitedPlaces).toHaveBeenCalledWith(COURSE, RANGE, 'm1');

    act(() => result.current.toggleMaterial('m1'));
    expect(result.current.expanded.m1).toBeUndefined();
  });

  it('stays empty without a course or a valid window, and reports errors', async () => {
    const { result, rerender } = renderHook(({ range }) => useCitedMaterials(COURSE, range), {
      initialProps: { range: null as typeof RANGE | null },
    });
    expect(result.current.materials).toEqual([]);
    expect(api.fetchCitedMaterials).not.toHaveBeenCalled();

    api.fetchCitedMaterials.mockRejectedValue(new Error('Access denied'));
    rerender({ range: RANGE });
    await waitFor(() => expect(result.current.error).toBe('Access denied'));
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useKeywordSearch', () => {
  it('searches, selects every matched place and counts questions there', async () => {
    api.matchKeyword.mockResolvedValue([pdfPlace, videoPlace]);
    api.fetchQuestionsAtPlaces.mockResolvedValue({ questionCount: 4, studentCount: 2, questions: [] });
    const { result } = renderHook(() => useKeywordSearch(COURSE, RANGE));

    act(() => result.current.setKeyword(' recursion '));
    await act(async () => result.current.search());

    expect(api.matchKeyword).toHaveBeenCalledWith(COURSE, 'recursion');
    expect(result.current.searchedKeyword).toBe('recursion');
    expect([...result.current.selectedKeys]).toEqual([pdfPlace.key, videoPlace.key]);
    await waitFor(() => expect(result.current.result?.questionCount).toBe(4));
    expect(api.fetchQuestionsAtPlaces).toHaveBeenLastCalledWith(COURSE, RANGE, [
      { material_id: 'm1', page_number: 3 },
      { material_id: 'v1', start_ms: 0, end_ms: 30000 },
    ]);
  });

  it('recounts when a place is unticked, and shows zero with nothing ticked', async () => {
    api.matchKeyword.mockResolvedValue([pdfPlace, videoPlace]);
    api.fetchQuestionsAtPlaces.mockResolvedValue({ questionCount: 1, studentCount: 1, questions: [] });
    const { result } = renderHook(() => useKeywordSearch(COURSE, RANGE));
    act(() => result.current.setKeyword('recursion'));
    await act(async () => result.current.search());
    await waitFor(() => expect(api.fetchQuestionsAtPlaces).toHaveBeenCalledTimes(1));

    act(() => result.current.togglePlace(videoPlace.key));
    await waitFor(() => expect(api.fetchQuestionsAtPlaces).toHaveBeenCalledTimes(2));
    expect(api.fetchQuestionsAtPlaces).toHaveBeenLastCalledWith(COURSE, RANGE, [{ material_id: 'm1', page_number: 3 }]);

    act(() => result.current.togglePlace(pdfPlace.key));
    await waitFor(() => expect(result.current.result).toEqual({ questionCount: 0, studentCount: 0, questions: [] }));
    expect(api.fetchQuestionsAtPlaces).toHaveBeenCalledTimes(2);
  });

  it('ignores a blank keyword and reports search errors', async () => {
    const { result } = renderHook(() => useKeywordSearch(COURSE, RANGE));
    await act(async () => result.current.search());
    expect(api.matchKeyword).not.toHaveBeenCalled();

    api.matchKeyword.mockRejectedValue(new Error('keyword is required'));
    act(() => result.current.setKeyword('x'));
    await act(async () => result.current.search());
    expect(result.current.searchError).toBe('keyword is required');
    expect(result.current.places).toEqual([]);
  });

  it('clears the search when the course changes', async () => {
    api.matchKeyword.mockResolvedValue([pdfPlace]);
    api.fetchQuestionsAtPlaces.mockResolvedValue({ questionCount: 1, studentCount: 1, questions: [] });
    const { result, rerender } = renderHook(({ course }) => useKeywordSearch(course, RANGE), { initialProps: { course: COURSE } });
    act(() => result.current.setKeyword('recursion'));
    await act(async () => result.current.search());
    rerender({ course: 'course-2' });
    expect(result.current.places).toEqual([]);
    expect(result.current.result).toBeNull();
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
  });

  it('stops when a round makes no progress and keeps the error', async () => {
    api.fetchQuestionBuckets.mockResolvedValue([]);
    api.labelQuestions.mockResolvedValue({ labeled: 0, failed: 2, remaining: 2, error: 'Decisions API error (403): not enabled' });
    const { result } = renderHook(() => useQuestionLabels(COURSE, RANGE));

    await waitFor(() => expect(result.current.labelError).toBe('Decisions API error (403): not enabled'));
    expect(api.labelQuestions).toHaveBeenCalledTimes(1);
    expect(result.current.remaining).toBe(2);
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
