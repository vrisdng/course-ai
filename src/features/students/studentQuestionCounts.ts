import { supabase } from '@/integrations/supabase/client';

/** How much one student has used the chat in a course. Never includes what they asked. */
export interface StudentQuestionCount {
  questionCount: number;
  lastQuestionAt: string | null;
}

export type QuestionSort = 'asc' | 'desc' | null;

/** Question counts for a course, keyed by user id. Students who never asked are absent. */
export async function fetchStudentQuestionCounts(courseId: string): Promise<Map<string, StudentQuestionCount>> {
  const { data, error } = await supabase.rpc('get_course_student_question_counts', { in_course_id: courseId });
  if (error) throw new Error(error.message);

  const counts = new Map<string, StudentQuestionCount>();
  for (const row of data ?? []) {
    counts.set(row.user_id, { questionCount: row.question_count, lastQuestionAt: row.last_question_at });
  }
  return counts;
}

/** Returns a sorted copy; ties keep roster order. `null` keeps the roster order. */
export function sortRosterByQuestions<T extends { questionCount: number | null }>(roster: T[], sort: QuestionSort): T[] {
  if (!sort) return [...roster];
  const direction = sort === 'desc' ? -1 : 1;
  return [...roster].sort((a, b) => direction * ((a.questionCount ?? -1) - (b.questionCount ?? -1)));
}
