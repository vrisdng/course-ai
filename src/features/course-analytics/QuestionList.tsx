import type { FormEvent } from 'react';
import { AlertTriangle, Loader2, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { AnalyticsCard, CardError, CardLoading } from './AnalyticsCard';
import type { AnalyticsQuestion } from './analyticsApi';
import {
  activeFilters,
  sourceLabel,
  sourceToPlace,
  type FilterName,
  type PlaceChoice,
  type QuestionFilters,
} from './questionFilters';
import { categoryLabel, plural } from './questionCategories';
import { SourceTag } from './SourceTag';
import type { QuestionFeedState } from './useQuestionFeed';
import type { TopicSearchState } from './useTopicSearch';

// Source tags shown per question before "+N more".
const SOURCES_SHOWN = 3;

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function formatAskedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

interface QuestionListProps {
  feed: QuestionFeedState;
  search: TopicSearchState;
  filters: QuestionFilters;
  onRemoveFilter(name: FilterName): void;
  onClearFilters(): void;
  onSelectPlace(place: PlaceChoice): void;
}

function QuestionItem({ question, onSelectPlace }: { question: AnalyticsQuestion; onSelectPlace(place: PlaceChoice): void }) {
  const shown = question.sources.slice(0, SOURCES_SHOWN);
  const hidden = question.sources.length - shown.length;
  const askedAt = formatAskedAt(question.createdAt);
  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0">
      <p className="break-words text-sm leading-relaxed">{question.queryText}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {askedAt && <time dateTime={question.createdAt}>{askedAt}</time>}
        <span>{categoryLabel(question.category)}</span>
        {question.needsAttention && (
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
            Not answered from materials
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {shown.map((source) => (
            <SourceTag
              key={`${source.materialId}:${source.pageNumber}:${source.startMs}:${source.endMs}`}
              label={sourceLabel(source)}
              fileType={source.fileType}
              onClick={() => onSelectPlace(sourceToPlace(source))}
            />
          ))}
          {hidden > 0 && <span className="text-xs text-muted-foreground">+{hidden} more</span>}
        </div>
      )}
    </li>
  );
}

// The questions students asked, newest first, with search and filters.
export function QuestionList({ feed, search, filters, onRemoveFilter, onClearFilters, onSelectPlace }: QuestionListProps) {
  const active = activeFilters(filters);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void search.submit();
  };

  return (
    <AnalyticsCard title="Questions" description="What students asked, newest first. Click a cited page or file to see every question about it.">
      <div className="space-y-4">
        <form role="search" onSubmit={onSubmit} className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search questions"
              value={search.input}
              maxLength={100}
              placeholder="Search a topic, e.g. collision resolution"
              onChange={(event) => search.setInput(event.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={search.isMatching}>
            {search.isMatching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Search
          </Button>
        </form>
        {search.note && <p className="text-xs text-muted-foreground">{search.note}</p>}

        {active.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {active.map((filter) => (
              <span key={filter.name} className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary py-1 pl-3 pr-1 text-xs font-medium text-secondary-foreground">
                <span className="truncate">{filter.label}</span>
                <button
                  type="button"
                  aria-label={`Remove filter: ${filter.label}`}
                  onClick={() => onRemoveFilter(filter.name)}
                  className="rounded-full p-0.5 hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearFilters}>Clear all</Button>
          </div>
        )}

        {feed.error && <CardError message={feed.error} />}
        {feed.isLoading && feed.questions.length === 0 ? (
          <CardLoading label="Loading questions" />
        ) : !feed.error && feed.questions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {active.length > 0 ? 'No questions match these filters.' : 'No questions in these dates.'}
          </p>
        ) : feed.questions.length > 0 && (
          <>
            <p className="text-sm font-medium">
              {plural(feed.totalCount, 'question')} from {plural(feed.studentCount, 'student')}
            </p>
            <ul className="divide-y divide-border">
              {feed.questions.map((question) => (
                <QuestionItem key={question.id} question={question} onSelectPlace={onSelectPlace} />
              ))}
            </ul>
            {feed.hasMore && (
              <Button variant="outline" className="w-full" onClick={() => void feed.loadMore()} disabled={feed.isLoadingMore}>
                {feed.isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Show more questions
              </Button>
            )}
          </>
        )}
      </div>
    </AnalyticsCard>
  );
}
