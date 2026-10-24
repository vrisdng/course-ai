import { useEffect, useRef, useState } from 'react';

export interface LoadState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

const IDLE = { data: null, isLoading: false, error: null };

export const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : 'Something went wrong');

// Runs load() whenever key changes; a null key means "nothing to load". The
// key must capture everything load depends on. Responses for an old key are
// dropped.
export function useLoader<T>(key: string | null, load: () => Promise<T>): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>(key ? { ...IDLE, isLoading: true } : IDLE);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!key) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, isLoading: true, error: null }));
    loadRef.current()
      .then((data) => {
        if (!cancelled) setState({ data, isLoading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, isLoading: false, error: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
