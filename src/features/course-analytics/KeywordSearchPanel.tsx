import { type FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { formatPlaceLabel } from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import { categoryLabel, plural } from './questionCategories';
import type { KeywordSearchState } from './useKeywordSearch';

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function KeywordSearchPanel({ state }: { state: KeywordSearchState }) {
  const {
    keyword, setKeyword, search, searchedKeyword, places, isSearching, searchError,
    selectedKeys, togglePlace, result, isCounting, countError,
  } = state;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void search();
  };

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="analytics-keyword" className="text-xs text-muted-foreground">Keyword</Label>
          <Input
            id="analytics-keyword"
            value={keyword}
            maxLength={100}
            placeholder="e.g. recursion"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={isSearching || !keyword.trim()}>
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          Search
        </Button>
      </form>

      {searchError && <p role="alert" className="text-sm text-destructive">{searchError}</p>}

      {searchedKeyword !== null && !searchError && places.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing in this course's materials matched "{searchedKeyword}". Try a broader or different word.
        </p>
      )}

      {places.length > 0 && (
        <>
          <div className="rounded-lg border border-border p-4">
            {countError ? (
              <p role="alert" className="text-sm text-destructive">{countError}</p>
            ) : (
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums">{result ? plural(result.questionCount, 'question') : '—'}</span>
                {result && <span className="text-muted-foreground"> from {plural(result.studentCount, 'student')}</span>}
                {isCounting && <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-muted-foreground" aria-label="Counting" />}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Questions whose answers cited a ticked place below. A cited page isn't always what the student asked about.
            </p>
          </div>

          <section aria-labelledby="keyword-places-heading" className="space-y-2">
            <h3 id="keyword-places-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Where "{searchedKeyword}" appears — untick wrong matches
            </h3>
            <ul className="space-y-1">
              {places.map((place) => {
                const id = `place-${place.key}`;
                return (
                  <li key={place.key} className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
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
              <h3 id="keyword-questions-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Questions{result.questionCount > result.questions.length ? ` (newest ${result.questions.length})` : ''}
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {result.questions.map((question) => (
                  <li key={question.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">{question.queryText}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{categoryLabel(question.category)}</span>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {question.createdAt ? dateFormatter.format(new Date(question.createdAt)) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
