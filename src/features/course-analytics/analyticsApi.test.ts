import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));

import {
  fetchCitedMaterials,
  fetchCitedPlaces,
  fetchQuestionBuckets,
  fetchQuestionsAtPlaces,
  labelQuestions,
  matchKeyword,
} from './analyticsApi';

const COURSE = 'course-1';
const RANGE = { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-24T00:00:00.000Z' };
const rangeArgs = { in_course_id: COURSE, in_start_at: RANGE.startAt, in_end_at: RANGE.endAt };

describe('analyticsApi RPCs', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it('maps cited materials to camelCase', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ material_id: 'm1', file_name: 'A.pdf', file_type: 'pdf', question_count: 3, student_count: 2, citation_count: 5, last_cited_at: null }],
      error: null,
    });
    await expect(fetchCitedMaterials(COURSE, RANGE)).resolves.toEqual([
      { materialId: 'm1', fileName: 'A.pdf', fileType: 'pdf', questionCount: 3, studentCount: 2, citationCount: 5, lastCitedAt: null },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_cited_materials', rangeArgs);
  });

  it('maps cited places with keys, for one material', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { material_id: 'm1', file_name: 'A.pdf', file_type: 'pdf', page_number: 4, start_ms: null, end_ms: null, question_count: 2, citation_count: 3 },
        { material_id: 'v1', file_name: 'L.mp4', file_type: 'video', page_number: null, start_ms: 0, end_ms: 300000, question_count: 1, citation_count: 1 },
      ],
      error: null,
    });
    const places = await fetchCitedPlaces(COURSE, RANGE, 'm1');
    expect(places.map((place) => place.key)).toEqual(['m1:page:4', 'v1:time:0-300000']);
    expect(places[0]).toMatchObject({ pageNumber: 4, startMs: null, questionCount: 2, citationCount: 3 });
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_cited_places', { ...rangeArgs, in_material_id: 'm1', in_limit: 100 });
  });

  it('maps question buckets', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ category: 'calculation', question_count: 4, labeled_count: 3, study_question_count: 3, answered_from_materials_count: 2 }],
      error: null,
    });
    await expect(fetchQuestionBuckets(COURSE, RANGE)).resolves.toEqual([
      { category: 'calculation', questionCount: 4, labeledCount: 3, studyQuestionCount: 3, answeredFromMaterialsCount: 2 },
    ]);
  });

  it('counts questions at places and validates the JSON shape', async () => {
    const places = [{ material_id: 'm1', page_number: 4 }];
    mocks.rpc.mockResolvedValueOnce({
      data: { question_count: 2, student_count: 1, questions: [{ id: 'q1', query_text: 'what is x', created_at: '2026-10-02T00:00:00Z', category: 'definition_concept' }] },
      error: null,
    });
    await expect(fetchQuestionsAtPlaces(COURSE, RANGE, places)).resolves.toEqual({
      questionCount: 2,
      studentCount: 1,
      questions: [{ id: 'q1', queryText: 'what is x', createdAt: '2026-10-02T00:00:00Z', category: 'definition_concept' }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_questions_at_places', { ...rangeArgs, in_places: places, in_question_limit: 50 });

    mocks.rpc.mockResolvedValueOnce({ data: 'nonsense', error: null });
    await expect(fetchQuestionsAtPlaces(COURSE, RANGE, places)).rejects.toThrow('Unexpected response');
  });

  it('throws the database error message', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Access denied' } });
    await expect(fetchCitedMaterials(COURSE, RANGE)).rejects.toThrow('Access denied');
  });
});

describe('analyticsApi edge function', () => {
  beforeEach(() => mocks.invoke.mockReset());

  it('matches a keyword', async () => {
    const places = [{ key: 'm1:page:1' }];
    mocks.invoke.mockResolvedValue({ data: { keyword: 'recursion', places }, error: null });
    await expect(matchKeyword(COURSE, 'recursion')).resolves.toEqual(places);
    expect(mocks.invoke).toHaveBeenCalledWith('course-analytics', {
      body: { action: 'match-keyword', courseId: COURSE, keyword: 'recursion' },
    });
  });

  it('labels a batch of questions in the window', async () => {
    mocks.invoke.mockResolvedValue({ data: { labeled: 3, failed: 0, remaining: 0 }, error: null });
    await expect(labelQuestions(COURSE, RANGE)).resolves.toEqual({ labeled: 3, failed: 0, remaining: 0 });
    expect(mocks.invoke).toHaveBeenCalledWith('course-analytics', {
      body: { action: 'label-questions', courseId: COURSE, startAt: RANGE.startAt, endAt: RANGE.endAt },
    });
  });

  it("surfaces the function's own error message", async () => {
    const context = new Response(JSON.stringify({ error: 'keyword is required' }), { status: 400 });
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context } });
    await expect(matchKeyword(COURSE, '')).rejects.toThrow('keyword is required');

    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request' } });
    await expect(matchKeyword(COURSE, 'x')).rejects.toThrow('Failed to send a request');
  });
});
