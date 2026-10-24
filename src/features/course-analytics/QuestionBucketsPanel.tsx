import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { CardEmpty, CardError, CardLoading } from './AnalyticsCard';
import { ProportionBar } from './ProportionBar';
import { categoryLabel, plural } from './questionCategories';
import type { QuestionLabelsState } from './useQuestionLabels';

interface QuestionBucketsPanelProps {
  state: QuestionLabelsState;
  selected: string | null;
  onSelect(category: string): void;
}

export function QuestionBucketsPanel({ state, selected, onSelect }: QuestionBucketsPanelProps) {
  const { buckets, isLoadingBuckets, bucketError, isLabelling, remaining, labelError } = state;

  if (bucketError) return <CardError message={bucketError} />;
  if (isLoadingBuckets && buckets.length === 0) return <CardLoading label="Loading question types" />;

  const maxQuestions = Math.max(1, ...buckets.map((bucket) => bucket.questionCount));

  return (
    <div className="space-y-3">
      {isLabelling && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Labelling questions…{remaining !== null ? ` ${remaining} left` : ''}
        </p>
      )}
      {labelError && <p role="alert" className="text-xs text-destructive">Some questions couldn't be labelled: {labelError}</p>}

      {buckets.length === 0 ? (
        <CardEmpty>No questions in these dates.</CardEmpty>
      ) : (
        <ul className="space-y-1">
          {buckets.map((bucket) => {
            const isSelected = selected === bucket.category;
            return (
              <li key={bucket.category}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(bucket.category)}
                  className={cn(
                    'w-full space-y-1.5 rounded-md px-2 py-2 text-left',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected ? 'bg-secondary' : 'hover:bg-muted/60',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{categoryLabel(bucket.category)}</span>
                    <span className="sr-only">, </span>
                    <span className="text-xs tabular-nums text-muted-foreground">{plural(bucket.questionCount, 'question')}</span>
                  </span>
                  <ProportionBar value={bucket.questionCount} max={maxQuestions} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!isLabelling && remaining !== null && remaining > 0 && (
        <p className="text-xs text-muted-foreground">
          {plural(remaining, 'question')} {remaining === 1 ? "isn't" : "aren't"} labelled yet and {remaining === 1 ? 'uses' : 'use'} a simpler rule-based type.
        </p>
      )}
    </div>
  );
}
