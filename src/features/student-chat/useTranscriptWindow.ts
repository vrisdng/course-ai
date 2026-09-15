import { useEffect, useRef, useState } from 'react';

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
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!materialId) {
      cancelledRef.current = false;
      setSegments([]);
      setIsLoading(false);
      return;
    }

    cancelledRef.current = false;
    setIsLoading(true);

    const windowStart = Math.max(0, startMs - windowMs);
    const windowEnd = (endMs ?? startMs) + windowMs;

    supabase
      .from('material_transcript_segments')
      .select('start_ms, end_ms, text')
      .eq('material_id', materialId)
      .gte('start_ms', windowStart)
      .lte('start_ms', windowEnd)
      .order('segment_index', { ascending: true })
      .then(({ data, error }) => {
        if (cancelledRef.current) return;
        if (error) console.error('Failed to load transcript segments:', error);
        setSegments(data ?? []);
        setIsLoading(false);
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [materialId, startMs, endMs, windowMs]);

  return { segments, isLoading };
}
