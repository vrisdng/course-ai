import { Loader2 } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';

import { formatPlaceLabel } from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import { categoryLabel, plural } from './questionCategories';
import type { KeywordSearchState } from './useKeywordSearch';

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

// What a searched keyword matched, how many questions cited it, and which.
// The search box lives in MaterialsExplorer.
export function KeywordResults({ state }: { state: KeywordSearchState }) {
  const { searchedKeyword, places, searchError, selectedKeys, togglePlace, result, isCounting, countError } = state;

  if (searchError) {
    return <p role="alert" className="text-sm text-destructive">{searchError}</p>;
  }
  if (searchedKeyword === null) return null;
  if (places.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing in this course's materials matched "{searchedKeyword}". Try a broader or different word.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-muted/40 p-4">
        {countError ? (
          <p role="alert" className="text-sm text-destructive">{countError}</p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-3xl font-semibold tabular-nums tracking-tight">{result ? plural(result.questionCount, 'question') : '—'}</span>
            {result && <span className="text-sm text-muted-foreground">from {plural(result.studentCount, 'student')}</span>}
            {isCounting && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" aria-label="Counting" />}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Questions whose answers cited a ticked place below. A cited page isn't always what the student asked about.
        </p>
      </div>

      <section aria-labelledby="keyword-places-heading" className="space-y-2">
        <h3 id="keyword-places-heading" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Where "{searchedKeyword}" appears · untick wrong matches
        </h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {places.map((place) => {
            const id = `place-${place.key}`;
            return (
              <li key={place.key} className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/40">
                <Checkbox
                  id={id}
                  checked={selectedKeys.has(place.key)}
                  onCheckedChange={() => togglePlace(place.key)}
                  className="mt-0.5"
                />
                <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm">
                  <span className="font-medium">{place.fileName}</span>
                  <span className="text-muted-foreground"> · {formatPlaceLabel(place)}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{place.snippet}</span>
                </label>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title="Similarity to the keyword">
                  {Math.round(place.similarity * 100)}%
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {result && result.questions.length > 0 && (
        <section aria-labelledby="keyword-questions-heading" className="space-y-2">
          <h3 id="keyword-questions-heading" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Questions{result.questionCount > result.questions.length ? ` · newest ${result.questions.length}` : ''}
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {result.questions.map((question) => (
              <li key={question.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm sm:flex-row sm:items-start sm:gap-3">
                <span className="min-w-0 flex-1">{question.queryText}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{categoryLabel(question.category)}</span>
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                    {question.createdAt ? dateFormatter.format(new Date(question.createdAt)) : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
