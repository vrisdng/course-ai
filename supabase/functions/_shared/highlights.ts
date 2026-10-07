// Locates a chunk on its rendered page. The renderer stores every text line of
// a page with a box; this finds the run of lines whose words the chunk
// contains and merges their boxes into the chunk's highlight. Chunk text comes
// from OCR, so it rarely equals the PDF text layer character for character:
// matching is on normalized words, not substrings.

// [x0, y0, x1, y1] as fractions of the page width/height, top-left origin.
export type Box = [number, number, number, number];

export interface PageLine {
  text: string;
  box: Box;
}

// A line counts as part of the chunk when this share of its words appear in it.
const LINE_MATCH_RATIO = 0.7;
// Lines shorter than this (page numbers, single labels) never anchor a match;
// they are only included when they sit inside a run of matched lines.
const MIN_ANCHOR_TOKENS = 3;
// Unmatched lines allowed inside a run (e.g. a line OCR garbled).
const MAX_GAP_LINES = 1;

export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function unionBoxes(boxes: Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

type LineState = "match" | "neutral" | "miss";

function classifyLine(line: PageLine, chunkWords: Set<string>): { state: LineState; matched: number } {
  const words = tokenize(line.text);
  const matched = words.filter((word) => chunkWords.has(word)).length;
  if (words.length < MIN_ANCHOR_TOKENS) {
    return { state: matched === words.length && words.length > 0 ? "neutral" : "miss", matched: 0 };
  }
  return { state: matched / words.length >= LINE_MATCH_RATIO ? "match" : "miss", matched };
}

export function matchChunkToLines(chunkText: string, lines: PageLine[]): Box | null {
  const chunkWords = new Set(tokenize(chunkText));
  if (chunkWords.size === 0 || lines.length === 0) {
    return null;
  }

  const classified = lines.map((line) => classifyLine(line, chunkWords));

  // Walk the lines in reading order, growing runs of matched lines that may
  // contain neutral lines and up to MAX_GAP_LINES misses; keep the run with
  // the most matched words.
  let best: { start: number; end: number; score: number } | null = null;
  let runStart = -1;
  let runEnd = -1;
  let runScore = 0;
  let gap = 0;

  const closeRun = () => {
    if (runStart >= 0 && (!best || runScore > best.score)) {
      best = { start: runStart, end: runEnd, score: runScore };
    }
    runStart = -1;
    runScore = 0;
    gap = 0;
  };

  classified.forEach(({ state, matched }, index) => {
    if (state === "match") {
      if (runStart < 0) runStart = index;
      runEnd = index;
      runScore += matched;
      gap = 0;
    } else if (runStart >= 0 && state === "miss") {
      gap += 1;
      if (gap > MAX_GAP_LINES) closeRun();
    }
  });
  closeRun();

  if (!best) {
    return null;
  }
  const { start, end } = best;
  return unionBoxes(lines.slice(start, end + 1).map((line) => line.box));
}
