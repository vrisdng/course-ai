import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCitedMaterials, fetchCitedPlaces, type AnalyticsRange, type CitedMaterial, type CitedPlace } from './analyticsApi';

export interface ExpandedMaterial {
  places: CitedPlace[] | null;
  isLoading: boolean;
  error: string | null;
}

export interface CitedMaterialsState {
  materials: CitedMaterial[];
  isLoading: boolean;
  error: string | null;
  // Materials whose pages/moments are shown, by material ID.
  expanded: Record<string, ExpandedMaterial>;
  toggleMaterial(materialId: string): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

// The materials answers cited in the window, most-asked first, with each
// material's cited pages or video moments loaded when it is expanded.
export function useCitedMaterials(courseId: string | null, range: AnalyticsRange | null): CitedMaterialsState {
  const [materials, setMaterials] = useState<CitedMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, ExpandedMaterial>>({});
  // Mirrors `expanded` so toggleMaterial can decide without a state updater.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const startAt = range?.startAt ?? null;
  const endAt = range?.endAt ?? null;

  useEffect(() => {
    setMaterials([]);
    setExpanded({});
    setError(null);
    if (!courseId || !startAt || !endAt) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetchCitedMaterials(courseId, { startAt, endAt })
      .then((rows) => {
        if (!cancelled) setMaterials(rows);
      })
      .catch((reason) => {
        if (!cancelled) setError(message(reason));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, startAt, endAt]);

  const toggleMaterial = useCallback((materialId: string) => {
    if (!courseId || !startAt || !endAt) return;
    if (expandedRef.current[materialId]) {
      setExpanded((current) => {
        const { [materialId]: _closed, ...rest } = current;
        return rest;
      });
      return;
    }
    setExpanded((current) => ({ ...current, [materialId]: { places: null, isLoading: true, error: null } }));

    const update = (next: ExpandedMaterial) =>
      setExpanded((current) => (current[materialId] ? { ...current, [materialId]: next } : current));
    fetchCitedPlaces(courseId, { startAt, endAt }, materialId)
      .then((places) => update({ places, isLoading: false, error: null }))
      .catch((reason) => update({ places: null, isLoading: false, error: message(reason) }));
  }, [courseId, startAt, endAt]);

  return { materials, isLoading, error, expanded, toggleMaterial };
}
