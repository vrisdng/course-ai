export interface AssemblyAIWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string | null;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number | null;
  speakerLabel?: string | null;
}

export interface TranscriptChunk {
  text: string;
  startMs: number;
  endMs: number;
}

const TARGET_CHUNK_CHARACTERS = 1200;
const MIN_CHUNK_CHARACTERS = 200;
const MAX_SEGMENT_MS = 15_000;
const SENTENCE_ENDERS = new Set([".", "?", "!"]);

export function isStoredVideoPath(path: string): boolean {
  return !!path && !path.startsWith("/") && !path.startsWith("course-materials/") &&
    !path.includes("://") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function groupWordsIntoSegments(words: AssemblyAIWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: AssemblyAIWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((word) => word.text).join(" ").trim();
    if (text) segments.push({
      startMs: current[0].start,
      endMs: current[current.length - 1].end,
      text,
      confidence: current.reduce((sum, word) => sum + word.confidence, 0) / current.length,
      speakerLabel: current[0].speaker ?? null,
    });
    current = [];
  };

  for (const word of words) {
    if (!word.text?.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start) continue;
    const prior = current[current.length - 1];
    if (prior && (word.start - prior.end > 2000 || word.speaker !== prior.speaker)) flush();
    current.push(word);
    if (SENTENCE_ENDERS.has(word.text.slice(-1)) || word.end - current[0].start >= MAX_SEGMENT_MS) flush();
  }
  flush();
  return segments;
}

export function buildTranscriptChunks(segments: TranscriptSegment[]): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let index = 0;
  while (index < segments.length) {
    const window: TranscriptSegment[] = [];
    let length = 0;
    let cursor = index;
    while (cursor < segments.length) {
      const segment = segments[cursor];
      const nextLength = length + (length ? 1 : 0) + segment.text.length;
      if (window.length && nextLength > TARGET_CHUNK_CHARACTERS && length >= MIN_CHUNK_CHARACTERS) break;
      window.push(segment);
      length = nextLength;
      cursor++;
      if (length >= TARGET_CHUNK_CHARACTERS) break;
    }
    if (!window.length) break;
    const text = window.map((segment) => segment.text).join(" ").trim();
    if (text) chunks.push({ text, startMs: window[0].startMs, endMs: window[window.length - 1].endMs });
    if (cursor >= segments.length) break;
    index = Math.max(index + 1, cursor - 1);
  }
  return chunks;
}
