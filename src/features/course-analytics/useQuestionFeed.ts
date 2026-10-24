import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchQuestions, type AnalyticsQuestion, type AnalyticsRange } from './analyticsApi';
import { toQuestionArgs, type QuestionFilters } from './questionFilters';
import { errorMessage } from './useLoader';

export const QUESTIONS_PER_PAGE = 25;

export interface QuestionFeedState {
  questions: AnalyticsQuestion[];
  totalCount: number;
  studentCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore(): Promise<void>;
}

// The filtered question list, newest first, a page at a time. Starts over
// when the course, window, filters or refreshKey (bumped after labelling)
// change.
export function useQuestionFeed(
  courseId: string | null,
  range: AnalyticsRange | null,
  filters: QuestionFilters,
  refreshKey: number,
): QuestionFeedState {
  const [questions, setQuestions] = useState<AnalyticsQuestion[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAt = range?.startAt ?? null;
  const endAt = range?.endAt ?? null;
  const key = courseId && startAt && endAt
    ? JSON.stringify([courseId, startAt, endAt, toQuestionArgs(filters), refreshKey])
    : null;
  // The latest inputs, for loadMore, and the key its pages belong to.
  const latest = useRef({ courseId, startAt, endAt, filters, key });
  latest.current = { courseId, startAt, endAt, filters, key };

  useEffect(() => {
    setQuestions([]);
    setTotalCount(0);
    setStudentCount(0);
    setError(null);
    if (!key) {
      setIsLoading(false);
      return;
    }
    const { courseId: course, startAt: start, endAt: end, filters: current } = latest.current;
    if (!course || !start || !end) return;
    let cancelled = false;
    setIsLoading(true);
    fetchQuestions(course, { startAt: start, endAt: end }, current, { limit: QUESTIONS_PER_PAGE, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        setQuestions(page.questions);
        setTotalCount(page.totalCount);
        setStudentCount(page.studentCount);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const loadedCount = questions.length;
  const loadMore = useCallback(async () => {
    const { courseId: course, startAt: start, endAt: end, filters: current, key: requestKey } = latest.current;
    if (!course || !start || !end) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchQuestions(course, { startAt: start, endAt: end }, current, {
        limit: QUESTIONS_PER_PAGE,
        offset: loadedCount,
      });
      if (latest.current.key !== requestKey) return;
      setQuestions((existing) => [...existing, ...page.questions.filter((q) => !existing.some((e) => e.id === q.id))]);
      setTotalCount(page.totalCount);
    } catch (caught) {
      if (latest.current.key === requestKey) setError(errorMessage(caught));
    } finally {
      setIsLoadingMore(false);
    }
  }, [loadedCount]);

  return {
    questions,
    totalCount,
    studentCount,
    isLoading,
    isLoadingMore,
    error,
    hasMore: questions.length < totalCount,
    loadMore,
  };
}
