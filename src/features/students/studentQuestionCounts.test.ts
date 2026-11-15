import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));

import { fetchStudentQuestionCounts, sortRosterByQuestions } from './studentQuestionCounts';

describe('fetchStudentQuestionCounts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for one course and keys the counts by user', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { user_id: 'u1', question_count: 4, last_question_at: '2026-11-14T08:00:00Z' },
        { user_id: 'u2', question_count: 1, last_question_at: '2026-11-12T08:00:00Z' },
      ],
      error: null,
    });

    const counts = await fetchStudentQuestionCounts('c1');

    expect(mocks.rpc).toHaveBeenCalledWith('get_course_student_question_counts', { in_course_id: 'c1' });
    expect(counts.get('u1')).toEqual({ questionCount: 4, lastQuestionAt: '2026-11-14T08:00:00Z' });
    expect(counts.get('u2')).toEqual({ questionCount: 1, lastQuestionAt: '2026-11-12T08:00:00Z' });
    expect(counts.has('u3')).toBe(false);
  });

  it('treats no rows as no questions', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await fetchStudentQuestionCounts('c1')).size).toBe(0);
  });

  it('throws the database error so the page can report it', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Access denied' } });
    await expect(fetchStudentQuestionCounts('c1')).rejects.toThrow('Access denied');
  });
});

describe('sortRosterByQuestions', () => {
  const roster = [
    { name: 'Ada', questionCount: 2 },
    { name: 'Bea', questionCount: 9 },
    { name: 'Cal', questionCount: 0 },
    { name: 'Dee', questionCount: 2 },
  ];

  it('orders most questions first, keeping roster order for ties', () => {
    expect(sortRosterByQuestions(roster, 'desc').map((r) => r.name)).toEqual(['Bea', 'Ada', 'Dee', 'Cal']);
  });

  it('orders fewest questions first', () => {
    expect(sortRosterByQuestions(roster, 'asc').map((r) => r.name)).toEqual(['Cal', 'Ada', 'Dee', 'Bea']);
  });

  it('leaves the roster order alone when not sorting, and never mutates its input', () => {
    const input = [...roster];
    expect(sortRosterByQuestions(input, null)).toEqual(roster);
    sortRosterByQuestions(input, 'desc');
    expect(input).toEqual(roster);
  });
});
