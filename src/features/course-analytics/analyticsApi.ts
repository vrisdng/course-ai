// Typed calls for the admin analytics page: the RPCs from migrations
// 20261024120000, 20261025090000 and 20261025120000, and the
// course-analytics edge function.
import { supabase } from '@/integrations/supabase/client';

import type { AnalyticsPlace, PlaceFilter } from '../../../supabase/functions/_shared/analyticsPlaces.ts';
import type { LabelQuestionsResponse } from '../../../supabase/functions/course-analytics/handler.ts';

import { toQuestionArgs, type QuestionFilters, type QuestionSource } from './questionFilters';
import { pickTopTerms, type QuestionTerm } from './questionTerms';

export type { AnalyticsPlace, LabelQuestionsResponse, PlaceFilter, QuestionTerm };

export interface AnalyticsRange {
  startAt: string;
  endAt: string;
}

export interface QuestionOverview {
  questionCount: number;
  studentCount: number;
  labeledCount: number;
  answeredFromMaterialsCount: number;
  needsAttentionCount: number;
  // Greetings and logistics: hidden when the list shows study questions only.
  nonStudyCount: number;
  citedQuestionCount: number;
  documentQuestionCount: number;
  videoQuestionCount: number;
}

// A cited file, with copies of it (same name) merged.
export interface CitedFile {
  fileName: string;
  fileType: string;
  materialIds: string[];
  questionCount: number;
  studentCount: number;
}

export interface QuestionBucket {
  category: string;
  questionCount: number;
  labeledCount: number;
  studyQuestionCount: number;
  answeredFromMaterialsCount: number;
}

export interface AnalyticsQuestion {
  id: string;
  queryText: string;
  createdAt: string;
  category: string;
  // Decisions API labels; null until labelled (or if the model refused).
  isStudyQuestion: boolean | null;
  answeredFromMaterials: boolean | null;
  needsAttention: boolean;
  sources: QuestionSource[];
}

export interface QuestionPage {
  totalCount: number;
  studentCount: number;
  questions: AnalyticsQuestion[];
}

export interface RelatedQuestion {
  id: string;
  queryText: string;
  createdAt: string;
  needsAttention: boolean;
}

export interface QuestionDetail extends AnalyticsQuestion {
  answerText: string | null;
  relatedCount: number;
  related: RelatedQuestion[];
}

function rangeArgs(courseId: string, range: AnalyticsRange) {
  return { in_course_id: courseId, in_start_at: range.startAt, in_end_at: range.endAt };
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const toNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const toFlag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

export async function fetchQuestionOverview(courseId: string, range: AnalyticsRange): Promise<QuestionOverview> {
  const rows = unwrap(await supabase.rpc('get_course_question_overview', rangeArgs(courseId, range)));
  const row = rows?.[0];
  if (!row) throw new Error('Unexpected response from get_course_question_overview');
  return {
    questionCount: Number(row.question_count),
    studentCount: Number(row.student_count),
    labeledCount: Number(row.labeled_count),
    answeredFromMaterialsCount: Number(row.answered_from_materials_count),
    needsAttentionCount: Number(row.needs_attention_count),
    nonStudyCount: Number(row.non_study_count),
    citedQuestionCount: Number(row.cited_question_count),
    documentQuestionCount: Number(row.document_question_count),
    videoQuestionCount: Number(row.video_question_count),
  };
}

export async function fetchCitedFiles(courseId: string, range: AnalyticsRange): Promise<CitedFile[]> {
  const rows = unwrap(await supabase.rpc('get_course_cited_files', rangeArgs(courseId, range)));
  return (rows ?? []).map((row) => ({
    fileName: row.file_name,
    fileType: row.file_type,
    materialIds: row.material_ids ?? [],
    questionCount: Number(row.question_count),
    studentCount: Number(row.student_count),
  }));
}

export async function fetchQuestionBuckets(courseId: string, range: AnalyticsRange): Promise<QuestionBucket[]> {
  const rows = unwrap(await supabase.rpc('get_course_question_buckets', rangeArgs(courseId, range)));
  return (rows ?? []).map((row) => ({
    category: row.category,
    questionCount: Number(row.question_count),
    labeledCount: Number(row.labeled_count),
    studyQuestionCount: Number(row.study_question_count),
    answeredFromMaterialsCount: Number(row.answered_from_materials_count),
  }));
}

function parseSource(value: Record<string, unknown>): QuestionSource {
  return {
    materialId: String(value.material_id),
    fileName: String(value.file_name ?? ''),
    fileType: String(value.file_type ?? ''),
    pageNumber: toNumber(value.page_number),
    startMs: toNumber(value.start_ms),
    endMs: toNumber(value.end_ms),
  };
}

function parseQuestion(value: Record<string, unknown>): AnalyticsQuestion {
  return {
    id: String(value.id),
    queryText: String(value.query_text ?? ''),
    createdAt: String(value.created_at ?? ''),
    category: String(value.category ?? 'other'),
    isStudyQuestion: toFlag(value.is_study_question),
    answeredFromMaterials: toFlag(value.answered_from_materials),
    needsAttention: value.needs_attention === true,
    sources: Array.isArray(value.sources) ? value.sources.filter(isRecord).map(parseSource) : [],
  };
}

function parseQuestionPage(value: unknown): QuestionPage {
  if (!isRecord(value) || typeof value.total_count !== 'number' || !Array.isArray(value.questions)) {
    throw new Error('Unexpected response from get_course_questions');
  }
  return {
    totalCount: value.total_count,
    studentCount: typeof value.student_count === 'number' ? value.student_count : 0,
    questions: value.questions.filter(isRecord).map(parseQuestion),
  };
}

export async function fetchQuestions(
  courseId: string,
  range: AnalyticsRange,
  filters: QuestionFilters,
  page: { limit: number; offset: number },
): Promise<QuestionPage> {
  const data = unwrap(await supabase.rpc('get_course_questions', {
    ...rangeArgs(courseId, range),
    ...toQuestionArgs(filters),
    in_limit: page.limit,
    in_offset: page.offset,
  }));
  return parseQuestionPage(data);
}

// null when the question isn't in this course and window.
export async function fetchQuestionDetail(
  courseId: string,
  range: AnalyticsRange,
  questionId: string,
): Promise<QuestionDetail | null> {
  const data = unwrap(await supabase.rpc('get_course_question_detail', {
    ...rangeArgs(courseId, range),
    in_question_id: questionId,
  }));
  const value: unknown = data;
  if (value === null) return null;
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error('Unexpected response from get_course_question_detail');
  }
  const related: unknown[] = Array.isArray(value.related) ? value.related : [];
  return {
    ...parseQuestion(value),
    answerText: typeof value.answer_text === 'string' ? value.answer_text : null,
    relatedCount: typeof value.related_count === 'number' ? value.related_count : 0,
    related: related.filter(isRecord).map((item) => ({
      id: String(item.id),
      queryText: String(item.query_text ?? ''),
      createdAt: String(item.created_at ?? ''),
      needsAttention: item.needs_attention === true,
    })),
  };
}

export async function fetchQuestionTerms(courseId: string, range: AnalyticsRange): Promise<QuestionTerm[]> {
  const rows = unwrap(await supabase.rpc('get_course_question_terms', rangeArgs(courseId, range)));
  return pickTopTerms((rows ?? []).map((row) => ({
    key: row.term_key,
    term: row.term,
    wordCount: Number(row.word_count),
    questionCount: Number(row.question_count),
    studentCount: Number(row.student_count),
  })));
}

// supabase-js reports a non-2xx function response with a generic message;
// the function's own { error } is in the response it attaches as context.
async function functionErrorMessage(error: { message: string; context?: unknown }): Promise<string> {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown };
      if (typeof body.error === 'string' && body.error) return body.error;
    } catch {
      // Fall back to the generic message.
    }
  }
  return error.message;
}

async function invokeCourseAnalytics<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('course-analytics', { body });
  if (error) throw new Error(await functionErrorMessage(error));
  return data as T;
}

export async function matchKeyword(courseId: string, keyword: string): Promise<AnalyticsPlace[]> {
  const data = await invokeCourseAnalytics<{ places: AnalyticsPlace[] }>({ action: 'match-keyword', courseId, keyword });
  return data.places;
}

export async function labelQuestions(courseId: string, range: AnalyticsRange): Promise<LabelQuestionsResponse> {
  return await invokeCourseAnalytics<LabelQuestionsResponse>({
    action: 'label-questions',
    courseId,
    startAt: range.startAt,
    endAt: range.endAt,
  });
}
