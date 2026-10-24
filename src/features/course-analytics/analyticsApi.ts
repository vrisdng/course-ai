// Typed calls for the citation-based admin analytics: the RPCs from migration
// 20261024120000 and the course-analytics edge function.
import { supabase } from '@/integrations/supabase/client';

import {
  placeKey,
  type AnalyticsPlace,
  type PlaceFilter,
  type PlaceLocation,
} from '../../../supabase/functions/_shared/analyticsPlaces.ts';
import type { LabelQuestionsResponse } from '../../../supabase/functions/course-analytics/handler.ts';

export type { AnalyticsPlace, LabelQuestionsResponse, PlaceFilter };

export interface AnalyticsRange {
  startAt: string;
  endAt: string;
}

export interface CitedMaterial {
  materialId: string;
  fileName: string;
  fileType: string;
  questionCount: number;
  studentCount: number;
  citationCount: number;
  lastCitedAt: string | null;
}

export interface CitedPlace extends PlaceLocation {
  key: string;
  materialId: string;
  fileName: string;
  fileType: string;
  questionCount: number;
  citationCount: number;
}

export interface QuestionBucket {
  category: string;
  questionCount: number;
  labeledCount: number;
  studyQuestionCount: number;
  answeredFromMaterialsCount: number;
}

export interface PlaceQuestion {
  id: string;
  queryText: string;
  createdAt: string;
  category: string;
}

export interface QuestionsAtPlaces {
  questionCount: number;
  studentCount: number;
  questions: PlaceQuestion[];
}

// Places listed when a material is expanded.
const PLACES_PER_MATERIAL = 100;
// Questions listed under a keyword's count.
const QUESTIONS_PER_KEYWORD = 50;

function rangeArgs(courseId: string, range: AnalyticsRange) {
  return { in_course_id: courseId, in_start_at: range.startAt, in_end_at: range.endAt };
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// Generated RPC types mark every returned column non-null; these rows say
// which ones can be null.
interface CitedMaterialRow {
  material_id: string;
  file_name: string;
  file_type: string;
  question_count: number;
  student_count: number;
  citation_count: number;
  last_cited_at: string | null;
}

interface CitedPlaceRow {
  material_id: string;
  file_name: string;
  file_type: string;
  page_number: number | null;
  start_ms: number | null;
  end_ms: number | null;
  question_count: number;
  citation_count: number;
}

export async function fetchCitedMaterials(courseId: string, range: AnalyticsRange): Promise<CitedMaterial[]> {
  const rows = unwrap(await supabase.rpc('get_course_cited_materials', rangeArgs(courseId, range))) as CitedMaterialRow[] | null;
  return (rows ?? []).map((row) => ({
    materialId: row.material_id,
    fileName: row.file_name,
    fileType: row.file_type,
    questionCount: Number(row.question_count),
    studentCount: Number(row.student_count),
    citationCount: Number(row.citation_count),
    lastCitedAt: row.last_cited_at,
  }));
}

export async function fetchCitedPlaces(courseId: string, range: AnalyticsRange, materialId: string): Promise<CitedPlace[]> {
  const rows = unwrap(await supabase.rpc('get_course_cited_places', {
    ...rangeArgs(courseId, range),
    in_material_id: materialId,
    in_limit: PLACES_PER_MATERIAL,
  })) as CitedPlaceRow[] | null;
  return (rows ?? []).map((row) => {
    const location: PlaceLocation = {
      pageNumber: row.page_number,
      startMs: row.start_ms === null ? null : Number(row.start_ms),
      endMs: row.end_ms === null ? null : Number(row.end_ms),
    };
    return {
      ...location,
      key: placeKey({ materialId: row.material_id, ...location }),
      materialId: row.material_id,
      fileName: row.file_name,
      fileType: row.file_type,
      questionCount: Number(row.question_count),
      citationCount: Number(row.citation_count),
    };
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseQuestionsAtPlaces(value: unknown): QuestionsAtPlaces {
  if (!isRecord(value) || typeof value.question_count !== 'number' || !Array.isArray(value.questions)) {
    throw new Error('Unexpected response from get_course_questions_at_places');
  }
  return {
    questionCount: value.question_count,
    studentCount: typeof value.student_count === 'number' ? value.student_count : 0,
    questions: value.questions.filter(isRecord).map((question) => ({
      id: String(question.id),
      queryText: String(question.query_text ?? ''),
      createdAt: String(question.created_at ?? ''),
      category: String(question.category ?? 'other'),
    })),
  };
}

export async function fetchQuestionsAtPlaces(
  courseId: string,
  range: AnalyticsRange,
  places: PlaceFilter[],
): Promise<QuestionsAtPlaces> {
  const data = unwrap(await supabase.rpc('get_course_questions_at_places', {
    ...rangeArgs(courseId, range),
    in_places: places,
    in_question_limit: QUESTIONS_PER_KEYWORD,
  }));
  return parseQuestionsAtPlaces(data);
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
