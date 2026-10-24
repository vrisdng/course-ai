import { type FormEvent } from 'react';
import { ArrowLeft, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { CitedMaterialsPanel } from './CitedMaterialsPanel';
import { KeywordResults } from './KeywordResults';
import type { CitedMaterialsState } from './useCitedMaterials';
import type { KeywordSearchState } from './useKeywordSearch';

interface MaterialsExplorerProps {
  materials: CitedMaterialsState;
  keyword: KeywordSearchState;
}

// The page's main card: cited materials by default, keyword results once a
// keyword has been searched.
export function MaterialsExplorer({ materials, keyword }: MaterialsExplorerProps) {
  const showingKeyword = keyword.searchedKeyword !== null || keyword.searchError !== null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void keyword.search();
  };

  return (
    <section aria-labelledby="explorer-heading" className="min-w-0 rounded-xl border border-border bg-card">
      <div className="space-y-4 border-b border-border p-5">
        <div>
          <h2 id="explorer-heading" className="text-base font-semibold">What students asked about</h2>
          <p className="text-sm text-muted-foreground">
            {showingKeyword
              ? 'Pages and video moments matching your topic, and the questions whose answers cited them.'
              : 'Materials their answers cited, most-asked first. Open one to see pages or video moments.'}
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex gap-2" role="search">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              aria-label="Search a topic in your materials"
              value={keyword.keyword}
              maxLength={100}
              placeholder="Search a topic, e.g. recursion"
              onChange={(event) => keyword.setKeyword(event.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" disabled={keyword.isSearching || !keyword.keyword.trim()}>
            {keyword.isSearching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Search
          </Button>
        </form>
      </div>

      <div className="p-5">
        {showingKeyword ? (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" className="-ml-2 h-8 text-muted-foreground" onClick={keyword.clear}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to all materials
            </Button>
            <KeywordResults state={keyword} />
          </div>
        ) : (
          <CitedMaterialsPanel state={materials} />
        )}
      </div>
    </section>
  );
}
