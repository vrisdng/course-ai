import { useCallback, useRef, useState } from 'react';

import { toPlaceFilters } from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import { matchKeyword } from './analyticsApi';
import type { SearchMode, Selection } from './questionFilters';
import { errorMessage } from './useLoader';

type SearchSelection = Extract<Selection, { kind: 'search' }>;

export interface TopicSearchState {
  input: string;
  setInput(value: string): void;
  submit(): Promise<void>;
  // Where to search; changing it re-runs the search in the box.
  mode: SearchMode;
  setMode(mode: SearchMode): void;
  isMatching: boolean;
  // Shown when the materials search failed.
  note: string | null;
}

// The question search box. Depending on the mode, a search matches
// questions that mention it, questions whose answers cited a page or moment
// where the materials cover it (found by embedding the text in the
// course-analytics function), or either. onSearch gets the selection to
// show, or null for a blank search.
export function useTopicSearch(
  courseId: string | null,
  onSearch: (selection: SearchSelection | null) => void,
): TopicSearchState {
  const [input, setInput] = useState('');
  const [mode, setModeState] = useState<SearchMode>('both');
  const [isMatching, setIsMatching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const request = useRef(0);

  const run = useCallback(async (rawText: string, searchMode: SearchMode) => {
    const text = rawText.trim();
    const id = ++request.current;
    setNote(null);
    setIsMatching(false);
    if (!text || !courseId) {
      onSearch(null);
      return;
    }
    if (searchMode === 'questions') {
      onSearch({ kind: 'search', text, mode: searchMode, places: null });
      return;
    }
    setIsMatching(true);
    try {
      const places = await matchKeyword(courseId, text);
      if (id === request.current) onSearch({ kind: 'search', text, mode: searchMode, places: toPlaceFilters(places) });
    } catch (error) {
      if (id !== request.current) return;
      const reason = `Couldn't search the materials (${errorMessage(error)})`;
      if (searchMode === 'materials') {
        // No places means nothing can match; say why rather than show all.
        setNote(`${reason}.`);
        onSearch({ kind: 'search', text, mode: searchMode, places: [] });
      } else {
        setNote(`${reason}, so this shows questions that mention it.`);
        onSearch({ kind: 'search', text, mode: searchMode, places: null });
      }
    } finally {
      if (id === request.current) setIsMatching(false);
    }
  }, [courseId, onSearch]);

  const submit = useCallback(() => run(input, mode), [input, mode, run]);

  const setMode = useCallback((next: SearchMode) => {
    setModeState(next);
    if (input.trim()) void run(input, next);
  }, [input, run]);

  return { input, setInput, submit, mode, setMode, isMatching, note };
}
