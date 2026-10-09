import { useEffect, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';

import type { RawSegment } from './groupTranscriptSegments';

const DEFAULT_WINDOW_MS = 30_000;

export function useTranscriptWindow(
  materialId: string | null,
  startMs: number,
  endMs: number | undefined,
  windowMs: number = DEFAULT_WINDOW_MS,
): { segments: RawSegment[]; isLoading: boolean } {
  const [segments, setSegments] = useState<RawSegment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    if (!materialId) {
      setSegments([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setSegments([]);

    const windowStart = Math.max(0, startMs - windowMs);
    const windowEnd = (endMs ?? startMs) + windowMs;

    supabase
      .from('material_transcript_segments')
      .select('id, start_ms, end_ms, text')
      .eq('material_id', materialId)
      .gte('end_ms', windowStart)
      .lte('start_ms', windowEnd)
      .order('segment_index', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('Failed to load transcript segments:', error);
        setSegments(data ?? []);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [materialId, startMs, endMs, windowMs]);

  return { segments, isLoading };
}
