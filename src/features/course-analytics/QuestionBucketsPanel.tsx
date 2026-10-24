import { Loader2 } from 'lucide-react';

import { ProportionBar } from './ProportionBar';
import { categoryLabel, plural } from './questionCategories';
import type { QuestionLabelsState } from './useQuestionLabels';

export function QuestionBucketsPanel({ state }: { state: QuestionLabelsState }) {
  const { buckets, isLoadingBuckets, bucketError, isLabelling, remaining, labelError } = state;

  if (bucketError) {
    return <p role="alert" className="text-sm text-destructive">{bucketError}</p>;
  }
  if (isLoadingBuckets && buckets.length === 0) {
    return (
      <div className="flex justify-center py-8" aria-label="Loading question types">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = (
    <>
      {isLabelling && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Labelling questions…{remaining !== null ? ` ${remaining} left` : ''}
        </p>
      )}
      {labelError && <p role="alert" className="text-xs text-destructive">Some questions couldn't be labelled: {labelError}</p>}
    </>
  );

  if (buckets.length === 0) {
    return (
      <div className="space-y-2">
        {status}
        <p className="py-8 text-center text-sm text-muted-foreground">No questions in this window.</p>
      </div>
    );
  }

  const maxQuestions = Math.max(...buckets.map((bucket) => bucket.questionCount));
  const labelled = buckets.reduce((sum, bucket) => sum + bucket.labeledCount, 0);
  const study = buckets.reduce((sum, bucket) => sum + bucket.studyQuestionCount, 0);
  const fromMaterials = buckets.reduce((sum, bucket) => sum + bucket.answeredFromMaterialsCount, 0);

  return (
    <div className="space-y-4">
      {status}
      {labelled > 0 && (
        <p className="text-sm">
          {study} of {plural(labelled, 'labelled question')} were study questions, and {fromMaterials} were answered from the course materials.
        </p>
      )}
      <ul className="space-y-3">
        {buckets.map((bucket) => (
          <li key={bucket.category} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{categoryLabel(bucket.category)}</span>
              <span className="text-xs tabular-nums">{plural(bucket.questionCount, 'question')}</span>
            </div>
            <ProportionBar value={bucket.questionCount} max={maxQuestions} />
          </li>
        ))}
      </ul>
      {!isLabelling && remaining !== null && remaining > 0 && (
        <p className="text-xs text-muted-foreground">
          {plural(remaining, 'question')} {remaining === 1 ? "isn't" : "aren't"} labelled yet and {remaining === 1 ? 'uses' : 'use'} a simpler rule-based type.
        </p>
      )}
    </div>
  );
}
