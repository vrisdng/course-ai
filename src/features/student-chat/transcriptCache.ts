import { supabase } from '@/integrations/supabase/client';

import type { RawSegment } from './groupTranscriptSegments';

export interface TranscriptSegment extends RawSegment {
  id: string;
  segment_index: number;
}

export const MAX_CACHED_TRANSCRIPTS = 3;
export const TRANSCRIPT_PAGE_SIZE = 500;

interface CacheEntry {
  promise: Promise<TranscriptSegment[]>;
  segments?: TranscriptSegment[];
}

const cache = new Map<string, CacheEntry>();

function touch(materialId: string, entry: CacheEntry): void {
  cache.delete(materialId);
  cache.set(materialId, entry);
}

async function download(
  materialId: string,
  onProgress?: (segments: TranscriptSegment[]) => void,
): Promise<TranscriptSegment[]> {
  const loaded: TranscriptSegment[] = [];
  for (let from = 0; ; from += TRANSCRIPT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('material_transcript_segments')
      .select('id, segment_index, start_ms, end_ms, text')
      .eq('material_id', materialId)
      .order('segment_index', { ascending: true })
      .range(from, from + TRANSCRIPT_PAGE_SIZE - 1);
    if (error) throw error;
    loaded.push(...((data ?? []) as TranscriptSegment[]));
    onProgress?.([...loaded]);
    if (!data || data.length < TRANSCRIPT_PAGE_SIZE) break;
  }
  return loaded;
}

export function peekCachedTranscript(materialId: string): TranscriptSegment[] | null {
  const entry = cache.get(materialId);
  if (!entry?.segments) return null;
  touch(materialId, entry);
  return entry.segments;
}

export function getCachedTranscript(
  materialId: string,
  onProgress?: (segments: TranscriptSegment[]) => void,
): Promise<TranscriptSegment[]> {
  const existing = cache.get(materialId);
  if (existing) {
    touch(materialId, existing);
    return existing.promise;
  }

  const entry: CacheEntry = { promise: Promise.resolve([]) };
  entry.promise = download(materialId, onProgress)
    .then((segments) => {
      entry.segments = segments;
      return segments;
    })
    .catch((error: unknown) => {
      cache.delete(materialId);
      throw error;
    });
  cache.set(materialId, entry);
  while (cache.size > MAX_CACHED_TRANSCRIPTS) {
    cache.delete(cache.keys().next().value as string);
  }
  return entry.promise;
}

export function clearTranscriptCache(): void {
  cache.clear();
}
