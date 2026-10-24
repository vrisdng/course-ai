import { useCallback, useEffect, useMemo, useState } from 'react';

import { toPlaceFilters } from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import {
  fetchQuestionsAtPlaces,
  matchKeyword,
  type AnalyticsPlace,
  type AnalyticsRange,
  type QuestionsAtPlaces,
} from './analyticsApi';

export interface KeywordSearchState {
  keyword: string;
  setKeyword(keyword: string): void;
  search(): Promise<void>;
  // The keyword the current places were found for.
  searchedKeyword: string | null;
  places: AnalyticsPlace[];
  isSearching: boolean;
  searchError: string | null;
  selectedKeys: ReadonlySet<string>;
  togglePlace(key: string): void;
  // Questions whose answers cited the ticked places, in the window.
  result: QuestionsAtPlaces | null;
  isCounting: boolean;
  countError: string | null;
}

const EMPTY_RESULT: QuestionsAtPlaces = { questionCount: 0, studentCount: 0, questions: [] };

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

// Keyword → the pages and video moments it matches (all ticked at first) →
// how many questions' answers cited the ticked ones. Unticking a wrong match
// recounts.
export function useKeywordSearch(courseId: string | null, range: AnalyticsRange | null): KeywordSearchState {
  const [keyword, setKeyword] = useState('');
  const [searchedKeyword, setSearchedKeyword] = useState<string | null>(null);
  const [places, setPlaces] = useState<AnalyticsPlace[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<QuestionsAtPlaces | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const startAt = range?.startAt ?? null;
  const endAt = range?.endAt ?? null;

  useEffect(() => {
    setSearchedKeyword(null);
    setPlaces([]);
    setSelectedKeys(new Set());
    setResult(null);
    setSearchError(null);
    setCountError(null);
  }, [courseId]);

  const search = useCallback(async () => {
    const trimmed = keyword.trim();
    if (!courseId || !trimmed) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const matched = await matchKeyword(courseId, trimmed);
      setPlaces(matched);
      setSelectedKeys(new Set(matched.map((place) => place.key)));
      setSearchedKeyword(trimmed);
    } catch (error) {
      setPlaces([]);
      setSelectedKeys(new Set());
      setResult(null);
      setSearchedKeyword(null);
      setSearchError(message(error));
    } finally {
      setIsSearching(false);
    }
  }, [courseId, keyword]);

  const togglePlace = useCallback((key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedPlaces = useMemo(
    () => places.filter((place) => selectedKeys.has(place.key)),
    [places, selectedKeys],
  );

  useEffect(() => {
    if (!courseId || !startAt || !endAt || searchedKeyword === null) return;
    if (selectedPlaces.length === 0) {
      setResult(EMPTY_RESULT);
      setCountError(null);
      return;
    }
    let cancelled = false;
    setIsCounting(true);
    setCountError(null);
    fetchQuestionsAtPlaces(courseId, { startAt, endAt }, toPlaceFilters(selectedPlaces))
      .then((counted) => {
        if (!cancelled) setResult(counted);
      })
      .catch((error) => {
        if (!cancelled) setCountError(message(error));
      })
      .finally(() => {
        if (!cancelled) setIsCounting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, startAt, endAt, searchedKeyword, selectedPlaces]);

  return {
    keyword, setKeyword, search, searchedKeyword, places, isSearching, searchError,
    selectedKeys, togglePlace, result, isCounting, countError,
  };
}
