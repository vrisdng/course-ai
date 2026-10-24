import { useCallback, useRef, useState } from 'react';

import { toPlaceFilters } from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import { matchKeyword } from './analyticsApi';
import type { TopicFilter } from './questionFilters';
import { errorMessage } from './useLoader';

export interface TopicSearchState {
  input: string;
  setInput(value: string): void;
  submit(): Promise<void>;
  isMatching: boolean;
  // Shown when the materials search failed and only question text matched.
  note: string | null;
}

// The question search box. A topic matches questions that mention it, or
// whose answers cited a page or moment where the materials cover it (found
// by embedding the topic in the course-analytics function).
export function useTopicSearch(courseId: string | null, onTopic: (topic: TopicFilter | null) => void): TopicSearchState {
  const [input, setInput] = useState('');
  const [isMatching, setIsMatching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const request = useRef(0);

  const submit = useCallback(async () => {
    const text = input.trim();
    const id = ++request.current;
    setNote(null);
    if (!text || !courseId) {
      onTopic(null);
      return;
    }
    setIsMatching(true);
    try {
      const places = await matchKeyword(courseId, text);
      if (id === request.current) onTopic({ text, places: toPlaceFilters(places), source: 'search' });
    } catch (error) {
      if (id !== request.current) return;
      setNote(`Couldn't search the materials (${errorMessage(error)}), so this shows questions that mention it.`);
      onTopic({ text, places: null, source: 'search' });
    } finally {
      if (id === request.current) setIsMatching(false);
    }
  }, [courseId, input, onTopic]);

  return { input, setInput, submit, isMatching, note };
}
