import { useEffect, useState } from 'react';

import { fetchQuestionBuckets, labelQuestions, type AnalyticsRange, type QuestionBucket } from './analyticsApi';

// Each round labels up to one batch (25) on the server; this caps how much
// one page visit labels.
export const MAX_LABEL_ROUNDS = 8;

export interface QuestionLabelsState {
  buckets: QuestionBucket[];
  isLoadingBuckets: boolean;
  bucketError: string | null;
  isLabelling: boolean;
  // Questions in the window still without an AI label, once known.
  remaining: number | null;
  labelError: string | null;
  // Goes up each time labelling changed some labels, so views can reload.
  version: number;
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

// Opening the page labels questions that have no AI label yet (Decisions
// API, via course-analytics), in rounds, once per course and window. The
// question buckets load separately, for study questions only when asked, and
// reload after labelling. Until labelled, a question shows its rule-based
// category.
export function useQuestionLabels(
  courseId: string | null,
  range: AnalyticsRange | null,
  studyOnly = false,
): QuestionLabelsState {
  const [buckets, setBuckets] = useState<QuestionBucket[]>([]);
  const [isLoadingBuckets, setIsLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [isLabelling, setIsLabelling] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const startAt = range?.startAt ?? null;
  const endAt = range?.endAt ?? null;

  useEffect(() => {
    setRemaining(null);
    setLabelError(null);
    if (!courseId || !startAt || !endAt) {
      setIsLabelling(false);
      return;
    }
    let cancelled = false;
    const window = { startAt, endAt };

    void (async () => {
      setIsLabelling(true);
      let labelledAny = false;
      try {
        for (let round = 0; round < MAX_LABEL_ROUNDS && !cancelled; round += 1) {
          const outcome = await labelQuestions(courseId, window);
          if (cancelled) return;
          setRemaining(outcome.remaining);
          setLabelError(outcome.error ?? null);
          labelledAny ||= outcome.labeled > 0;
          if (outcome.remaining === 0 || outcome.labeled === 0) break;
        }
      } catch (error) {
        if (!cancelled) setLabelError(message(error));
      } finally {
        if (!cancelled) setIsLabelling(false);
      }
      if (labelledAny && !cancelled) setVersion((current) => current + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId, startAt, endAt]);

  useEffect(() => {
    if (!courseId || !startAt || !endAt) {
      setBuckets([]);
      setBucketError(null);
      setIsLoadingBuckets(false);
      return;
    }
    let cancelled = false;
    setIsLoadingBuckets(true);
    setBucketError(null);
    fetchQuestionBuckets(courseId, { startAt, endAt }, studyOnly)
      .then((rows) => {
        if (!cancelled) setBuckets(rows);
      })
      .catch((error) => {
        if (!cancelled) setBucketError(message(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBuckets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, startAt, endAt, studyOnly, version]);

  return { buckets, isLoadingBuckets, bucketError, isLabelling, remaining, labelError, version };
}
