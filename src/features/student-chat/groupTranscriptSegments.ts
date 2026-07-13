const PARAGRAPH_DURATION_MS = 60_000; // 1 minute
const GRACE_MS = 30_000;              // max extra time to look for a sentence boundary
const SENTENCE_ENDERS = new Set(['.', '?', '!']);

export interface DisplaySegment {
  id: string;        // synthetic key
  startMs: number;
  endMs: number;
  text: string;
  index: number;     // paragraph number (0-based)
}

export interface RawSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

/**
 * Merges fine-grained transcript segments into ~1-minute display paragraphs.
 * The cut is deferred to the nearest sentence boundary (ending in . ? !)
 * up to GRACE_MS after the 1-minute mark. If no boundary is found within
 * the grace period, the paragraph is cut at the current word anyway.
 */
export function groupSegmentsIntoParagraphs(segments: RawSegment[]): DisplaySegment[] {
  if (segments.length === 0) return [];

  const paragraphs: DisplaySegment[] = [];
  let bucket: RawSegment[] = [];
  let hardCutAt: number | null = null;
  let paraIndex = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    paragraphs.push({
      id: `para-${paraIndex}`,
      startMs: bucket[0].start_ms,
      endMs: bucket[bucket.length - 1].end_ms,
      text: bucket.map((s) => s.text).join(' ').trim(),
      index: paraIndex,
    });
    paraIndex++;
    bucket = [];
    hardCutAt = null;
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    bucket.push(seg);

    const duration = seg.end_ms - (bucket[0]?.start_ms ?? seg.start_ms);
    const isLast = i === segments.length - 1;
    const isSentenceEnd = SENTENCE_ENDERS.has(seg.text.trim().slice(-1));

    if (hardCutAt === null && duration >= PARAGRAPH_DURATION_MS) {
      hardCutAt = (bucket[0]?.start_ms ?? seg.start_ms) + PARAGRAPH_DURATION_MS + GRACE_MS;
    }

    const shouldCut =
      isLast ||
      (hardCutAt !== null && isSentenceEnd) ||
      (hardCutAt !== null && seg.end_ms >= hardCutAt);

    if (shouldCut) flush();
  }

  return paragraphs;
}
