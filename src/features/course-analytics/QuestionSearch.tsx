import type { FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';

import type { TopicSearchState } from './useTopicSearch';

// Search across every question in the dates, whatever view is open. Sits
// above the views, since a search replaces the view rather than filtering it.
export function QuestionSearch({ search }: { search: TopicSearchState }) {
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void search.submit();
  };

  return (
    <div className="space-y-1.5">
      <form role="search" onSubmit={onSubmit} className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Search all questions"
          value={search.input}
          maxLength={100}
          placeholder="Search all questions…"
          onChange={(event) => search.setInput(event.target.value)}
          className="h-8 pl-8 pr-8 text-sm"
        />
        {search.isMatching && (
          // The wrapper centres the icon; animate-spin replaces the icon's
          // own transform, so the icon can't carry the centring itself.
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Searching" />
          </span>
        )}
      </form>
      {search.note && <p className="text-xs text-muted-foreground">{search.note}</p>}
    </div>
  );
}
