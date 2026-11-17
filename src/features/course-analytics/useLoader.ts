import { useEffect, useRef, useState } from 'react';

export interface LoadState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

const IDLE = { data: null, isLoading: false, error: null };

export const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : 'Something went wrong');

interface KeyedState<T> extends LoadState<T> {
  // The key this state was loaded for.
  key: string | null;
}

// Runs load() whenever key changes; a null key means "nothing to load". The
// key must capture everything load depends on. Responses for an old key are
// dropped, and an old key's data is never returned for a new key: while the
// new key loads, data is null (so a detail pane can't show the last item's
// content under the newly selected one).
export function useLoader<T>(key: string | null, load: () => Promise<T>): LoadState<T> {
  const [state, setState] = useState<KeyedState<T>>({ ...IDLE, key: null });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadRef.current()
      .then((data) => {
        if (!cancelled) setState({ data, isLoading: false, error: null, key });
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, isLoading: false, error: errorMessage(error), key });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return IDLE;
  if (state.key !== key) return { data: null, isLoading: true, error: null };
  return { data: state.data, isLoading: state.isLoading, error: state.error };
}
