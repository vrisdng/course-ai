import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));

import { ALL_QUESTIONS, filtersFor, toQuestionArgs } from './questionFilters';
import {
  fetchCitedFiles,
  fetchQuestionDetail,
  fetchQuestionBuckets,
  fetchQuestionOverview,
  fetchQuestions,
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

  it('maps cited files with copies merged', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ file_name: 'A.pdf', file_type: 'pdf', material_ids: ['m1', 'm2'], question_count: 3, student_count: 2 }],
      error: null,
    });
    await expect(fetchCitedFiles(COURSE, RANGE)).resolves.toEqual([
      { fileName: 'A.pdf', fileType: 'pdf', materialIds: ['m1', 'm2'], questionCount: 3, studentCount: 2 },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_cited_files', rangeArgs);
  });

  it('fetches one question with its answer and related questions', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'q1', query_text: 'what is x', created_at: '2026-10-02T00:00:00Z', category: 'comparison',
        is_study_question: true, answered_from_materials: false, needs_attention: true, sources: [],
        answer_text: 'X is <<cite:1>> y.', related_count: 12,
        related: [{ id: 'q2', query_text: 'and y?', created_at: '2026-10-01T00:00:00Z', needs_attention: false }],
      },
      error: null,
    });
    await expect(fetchQuestionDetail(COURSE, RANGE, 'q1')).resolves.toMatchObject({
      id: 'q1', needsAttention: true, answerText: 'X is <<cite:1>> y.', relatedCount: 12,
      related: [{ id: 'q2', queryText: 'and y?', createdAt: '2026-10-01T00:00:00Z', needsAttention: false }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_question_detail', { ...rangeArgs, in_question_id: 'q1' });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchQuestionDetail(COURSE, RANGE, 'gone')).resolves.toBeNull();
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(fetchQuestionDetail(COURSE, RANGE, 'q1')).rejects.toThrow('Unexpected response');
  });

  it('maps question buckets', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ category: 'calculation', question_count: 4, labeled_count: 3, study_question_count: 3, answered_from_materials_count: 2 }],
      error: null,
    });
    await expect(fetchQuestionBuckets(COURSE, RANGE, true)).resolves.toEqual([
      { category: 'calculation', questionCount: 4, labeledCount: 3, studyQuestionCount: 3, answeredFromMaterialsCount: 2 },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_question_buckets', { ...rangeArgs, in_study_only: true });
  });

  it('maps the overview numbers', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        question_count: 31, student_count: 2, labeled_count: 30, answered_from_materials_count: 21,
        needs_attention_count: 8, non_study_count: 4, cited_question_count: 25, document_question_count: 25, video_question_count: 3,
      }],
      error: null,
    });
    await expect(fetchQuestionOverview(COURSE, RANGE)).resolves.toEqual({
      questionCount: 31, studentCount: 2, labeledCount: 30, answeredFromMaterialsCount: 21,
      needsAttentionCount: 8, nonStudyCount: 4, citedQuestionCount: 25, documentQuestionCount: 25, videoQuestionCount: 3,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_question_overview', rangeArgs);

    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchQuestionOverview(COURSE, RANGE)).rejects.toThrow('Unexpected response');
  });

  it('fetches a page of questions with the filters and validates the JSON shape', async () => {
    const filters = filtersFor({ kind: 'attention' }, true);
    mocks.rpc.mockResolvedValueOnce({
      data: {
        total_count: 40,
        student_count: 6,
        questions: [{
          id: 'q1', query_text: 'what is x', created_at: '2026-10-02T00:00:00Z', category: 'definition_concept',
          is_study_question: true, answered_from_materials: null, needs_attention: true,
          sources: [{ material_id: 'v1', file_name: 'L.mp4', file_type: 'video', page_number: null, start_ms: 65000, end_ms: 80000 }],
        }],
      },
      error: null,
    });
    await expect(fetchQuestions(COURSE, RANGE, filters, { limit: 25, offset: 25 })).resolves.toEqual({
      totalCount: 40,
      studentCount: 6,
      questions: [{
        id: 'q1', queryText: 'what is x', createdAt: '2026-10-02T00:00:00Z', category: 'definition_concept',
        isStudyQuestion: true, answeredFromMaterials: null, needsAttention: true,
        sources: [{ materialId: 'v1', fileName: 'L.mp4', fileType: 'video', pageNumber: null, startMs: 65000, endMs: 80000 }],
      }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_questions', {
      ...rangeArgs, ...toQuestionArgs(filters), in_limit: 25, in_offset: 25,
    });

    mocks.rpc.mockResolvedValueOnce({ data: { questions: 'nope' }, error: null });
    await expect(fetchQuestions(COURSE, RANGE, filtersFor(ALL_QUESTIONS, false), { limit: 25, offset: 0 })).rejects.toThrow('Unexpected response');
  });

  it('throws the database error message', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Access denied' } });
    await expect(fetchCitedFiles(COURSE, RANGE)).rejects.toThrow('Access denied');
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
