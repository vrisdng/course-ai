import { cn } from '@/lib/utils';

import { AnalyticsCard, CardEmpty, CardError, CardLoading } from './AnalyticsCard';
import { plural } from './questionCategories';
import type { QuestionTerm } from './questionTerms';
import type { LoadState } from './useLoader';

interface TopicsCardProps {
  terms: LoadState<QuestionTerm[]>;
  selected: string | null;
  onSelect(term: string): void;
}

// Words and phrases that keep coming up in questions, ranked.
export function TopicsCard({ terms, selected, onSelect }: TopicsCardProps) {
  return (
    <AnalyticsCard title="Common topics" description="Words and phrases from questions that also appear in your materials.">
      {terms.error ? <CardError message={terms.error} />
        : terms.isLoading && !terms.data ? <CardLoading label="Loading topics" />
        : !terms.data?.length ? (
          <CardEmpty>No topic came up in more than one question yet.</CardEmpty>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {terms.data.map((term) => {
              const isSelected = selected === term.term;
              return (
                <li key={term.key}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${term.term}, ${plural(term.questionCount, 'question')}`}
                    onClick={() => onSelect(term.term)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-muted',
                    )}
                  >
                    <span>{term.term}</span>
                    <span className={cn('text-xs tabular-nums', isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                      {term.questionCount}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </AnalyticsCard>
  );
}
