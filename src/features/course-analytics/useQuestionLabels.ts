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
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

// Question buckets for the window. Opening the page also labels questions
// that have no AI label yet (Decisions API, via course-analytics), in rounds,
// then reloads the buckets. Until then, unlabelled questions show their
// rule-based category.
export function useQuestionLabels(courseId: string | null, range: AnalyticsRange | null): QuestionLabelsState {
  const [buckets, setBuckets] = useState<QuestionBucket[]>([]);
  const [isLoadingBuckets, setIsLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [isLabelling, setIsLabelling] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const startAt = range?.startAt ?? null;
  const endAt = range?.endAt ?? null;

  useEffect(() => {
    setBuckets([]);
    setBucketError(null);
    setRemaining(null);
    setLabelError(null);
    if (!courseId || !startAt || !endAt) {
      setIsLoadingBuckets(false);
      setIsLabelling(false);
      return;
    }
    let cancelled = false;
    const window = { startAt, endAt };

    const loadBuckets = async () => {
      setIsLoadingBuckets(true);
      try {
        const rows = await fetchQuestionBuckets(courseId, window);
        if (!cancelled) {
          setBuckets(rows);
          setBucketError(null);
        }
      } catch (error) {
        if (!cancelled) setBucketError(message(error));
      } finally {
        if (!cancelled) setIsLoadingBuckets(false);
      }
    };

    const label = async () => {
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
      if (labelledAny && !cancelled) await loadBuckets();
    };

    void loadBuckets().then(label);
    return () => {
      cancelled = true;
    };
  }, [courseId, startAt, endAt]);

  return { buckets, isLoadingBuckets, bucketError, isLabelling, remaining, labelError };
}
