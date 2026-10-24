import type { FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { categoryLabel, plural } from './questionCategories';
import type { QuestionFeedState } from './useQuestionFeed';
import type { TopicSearchState } from './useTopicSearch';

interface QuestionsPaneProps {
  title: string;
  feed: QuestionFeedState;
  search: TopicSearchState;
  studyOnly: boolean;
  onStudyOnlyChange(studyOnly: boolean): void;
  selectedId: string | null;
  onSelectQuestion(id: string): void;
  // Small screens show one pane at a time.
  onBack?(): void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

// The middle pane: the questions for the current selection, one compact row
// each.
export function QuestionsPane({
  title, feed, search, studyOnly, onStudyOnlyChange, selectedId, onSelectQuestion, onBack,
}: QuestionsPaneProps) {
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void search.submit();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-border p-3">
        {onBack && (
          <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-muted-foreground lg:hidden" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to views
          </Button>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          {!feed.isLoading && !feed.error && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {plural(feed.totalCount, 'question')} · {plural(feed.studentCount, 'student')}
            </span>
          )}
        </div>
        <form role="search" onSubmit={onSubmit} className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search questions"
            value={search.input}
            maxLength={100}
            placeholder="Search a topic…"
            onChange={(event) => search.setInput(event.target.value)}
            className="h-8 pl-8 pr-8 text-sm"
          />
          {search.isMatching && (
            <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />
          )}
        </form>
        {search.note && <p className="text-xs text-muted-foreground">{search.note}</p>}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={studyOnly}
            onCheckedChange={(checked) => onStudyOnlyChange(checked === true)}
            aria-label="Hide greetings and logistics"
          />
          Hide greetings and logistics
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {feed.error ? (
          <p role="alert" className="p-4 text-sm text-destructive">{feed.error}</p>
        ) : feed.isLoading && feed.questions.length === 0 ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading questions" />
          </div>
        ) : feed.questions.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No questions here.</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {feed.questions.map((question) => {
                const isCurrent = question.id === selectedId;
                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => onSelectQuestion(question.id)}
                      className={cn(
                        'block w-full space-y-1 px-3 py-2.5 text-left',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        isCurrent ? 'bg-secondary' : 'hover:bg-muted/60',
                      )}
                    >
                      <span className="line-clamp-2 text-sm">{question.queryText}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{formatDay(question.createdAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{categoryLabel(question.category)}</span>
                        {question.needsAttention && (
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />
                            Not from materials
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {feed.hasMore && (
              <div className="p-3">
                <Button variant="ghost" size="sm" className="w-full" onClick={() => void feed.loadMore()} disabled={feed.isLoadingMore}>
                  {feed.isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
