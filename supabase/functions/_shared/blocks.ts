// Page blocks: the atomic, citable pieces of a PDF page (a heading, a
// paragraph, an equation, a figure...). The OCR model reads rendered page
// images and returns each block with its text and an approximate box; boxes
// are then snapped onto the PDF's own text lines where it has a text layer.
// Chunks are built from whole blocks and remember which blocks they hold, so
// an answer can cite individual blocks and the viewer can box exactly those.
import { chunkText, normalizeChunkText } from "./chunking.ts";
import type { PageRange } from "./extraction.ts";
import { tokenize, unionBoxes, type Box, type PageLine } from "./highlights.ts";

export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list_item",
  "sentence",
  "equation",
  "table",
  "figure",
  "caption",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

// A block as read from the model, before it is stored.
export interface ExtractedBlock {
  pageNumber: number;
  // Position on its page, 0-based, in reading order.
  ordinal: number;
  type: BlockType;
  text: string;
  box: Box | null;
}

// A block as stored in page_blocks.
export interface StoredBlock extends ExtractedBlock {
  id: string;
}

export interface BlockChunk {
  text: string;
  // Offsets within the page's text (its blocks joined by blank lines).
  start: number;
  end: number;
  pageNumber: number;
  blockIds: string[];
  // Union of the chunk's block boxes, for citations of the whole chunk.
  highlightBox: Box | null;
}

const BOX_GRID = 1000;
// Blocks whose box can be snapped onto text-layer lines. Figures and
// equations keep the model's box (shifted by the page's measured offset).
const SNAPPABLE_TYPES = new Set<BlockType>(["heading", "paragraph", "list_item", "sentence", "caption", "table"]);
// A line belongs to a block when this share of its words appear in the block.
const LINE_IN_BLOCK_RATIO = 0.8;
// Lines shorter than this (page numbers, lone labels) are never assigned.
const MIN_LINE_TOKENS = 2;
// The offset correction only applies when it was measured on enough blocks,
// and only with a plausible scale.
const MIN_CALIBRATION_BLOCKS = 2;
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.25;
// Long single blocks are split like plain text.
const OVERSIZED_BLOCK_OVERLAP = 200;

export function buildBlockExtractionPrompt(range: PageRange): string {
  return `The images are pages ${range.start} to ${range.end} of a document, each labelled [Page N].
Extract every page as a list of blocks, in reading order.
A block is one atomic, citable unit: ${BLOCK_TYPES.join(", ")}.
Output format, exactly:
[Page N]  (e.g. [Page ${range.start}], using the label shown before each image)
then one JSON object per line: {"type": "...", "box": [x0, y0, x1, y1], "text": "..."}
Rules:
- type is one of ${BLOCK_TYPES.join(", ")}. Use sentence for a sentence that stands alone; list_item for each bullet or numbered item.
- box is the tightest box around the block on its page, in a 0-1000 grid (0,0 = top-left corner of the page, 1000,1000 = bottom-right).
- text is verbatim. Write all mathematics in LaTeX: $...$ inline, and an equation block's text as $$...$$.
- table text is the table in Markdown. figure text is one sentence describing what the figure shows, followed by any labels in it.
- Do not summarize, merge or skip blocks. Ignore running headers, footers and page numbers.
- Return only the page markers and JSON lines.`;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseBox(value: unknown): Box | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return null;
  }
  const [x0, y0, x1, y1] = (value as number[]).map((n) => round4(Math.min(BOX_GRID, Math.max(0, n)) / BOX_GRID));
  return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : null;
}

function parseBlockLine(line: string): Omit<ExtractedBlock, "pageNumber" | "ordinal"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    const text = normalizeChunkText(line);
    return text ? { type: "paragraph", text, box: null } : null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { type, text, box } = parsed as Record<string, unknown>;
  const cleaned = typeof text === "string" ? normalizeChunkText(text) : "";
  if (!cleaned) return null;
  return {
    type: (BLOCK_TYPES as readonly string[]).includes(type as string) ? (type as BlockType) : "paragraph",
    text: cleaned,
    box: parseBox(box),
  };
}

export function parseBlockOutput(raw: string, range: PageRange): ExtractedBlock[] {
  const pages: { pageNumber: number; blocks: Omit<ExtractedBlock, "pageNumber" | "ordinal">[] }[] = [];
  for (const line of raw.split("\n")) {
    const marker = line.match(/^\s*\[Page\s+(\d+)\]\s*$/i);
    if (marker) {
      pages.push({ pageNumber: Number(marker[1]), blocks: [] });
      continue;
    }
    if (!line.trim() || pages.length === 0) continue;
    const block = parseBlockLine(line.trim());
    if (block) pages[pages.length - 1].blocks.push(block);
  }

  // Same correction as normalizeRangeSegments: the model sometimes numbers
  // the range from 1 instead of using the page labels.
  const rangeLength = range.end - range.start + 1;
  const restartedAtOne =
    range.start > 1 && pages.length > 0 && pages.every((p) => p.pageNumber >= 1 && p.pageNumber <= rangeLength);
  const offset = restartedAtOne ? range.start - 1 : 0;

  return pages
    .map((p) => ({ ...p, pageNumber: p.pageNumber + offset }))
    .filter((p) => p.pageNumber >= range.start && p.pageNumber <= range.end)
    .flatMap((p) => p.blocks.map((b, ordinal) => ({ pageNumber: p.pageNumber, ordinal, ...b })));
}

function verticalDistance(box: Box | null, y: number): number {
  if (!box) return Number.POSITIVE_INFINITY;
  if (y < box[1]) return box[1] - y;
  if (y > box[3]) return y - box[3];
  return 0;
}

interface AxisFit {
  scale: number;
  offset: number;
}

// Least-squares fit of true = scale * model + offset; falls back to a pure
// offset when the fitted scale is implausible (too few distinct points).
function fitAxis(pairs: [number, number][]): AxisFit {
  const n = pairs.length;
  const meanModel = pairs.reduce((sum, [m]) => sum + m, 0) / n;
  const meanTrue = pairs.reduce((sum, [, t]) => sum + t, 0) / n;
  const variance = pairs.reduce((sum, [m]) => sum + (m - meanModel) ** 2, 0);
  const scale = variance > 0
    ? pairs.reduce((sum, [m, t]) => sum + (m - meanModel) * (t - meanTrue), 0) / variance
    : 1;
  if (scale < MIN_SCALE || scale > MAX_SCALE) {
    return { scale: 1, offset: meanTrue - meanModel };
  }
  return { scale, offset: meanTrue - scale * meanModel };
}

// Replaces each text block's approximate box with the union of the real text
// lines it contains, then shifts the remaining boxes by the offset measured on
// the snapped blocks. Blocks are one page's, in reading order.
export function snapBlocksToLines<T extends ExtractedBlock>(blocks: T[], lines: PageLine[]): T[] {
  if (lines.length === 0 || blocks.length === 0) return blocks;

  const blockWords = blocks.map((b) => (SNAPPABLE_TYPES.has(b.type) ? new Set(tokenize(b.text)) : null));
  const assigned: Box[][] = blocks.map(() => []);

  for (const line of lines) {
    const words = tokenize(line.text);
    if (words.length < MIN_LINE_TOKENS) continue;
    const centreY = (line.box[1] + line.box[3]) / 2;
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    blocks.forEach((b, index) => {
      const set = blockWords[index];
      if (!set) return;
      const shared = words.filter((w) => set.has(w)).length;
      if (shared / words.length < LINE_IN_BLOCK_RATIO) return;
      const distance = verticalDistance(b.box, centreY);
      if (best === -1 || distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    if (best >= 0) assigned[best].push(line.box);
  }

  const snapped = blocks.map((b, index) => (assigned[index].length > 0 ? { ...b, box: unionBoxes(assigned[index]) } : b));

  const calibration = blocks
    .map((b, index) => ({ model: b.box, real: assigned[index].length > 0 ? snapped[index].box : null }))
    .filter((p): p is { model: Box; real: Box } => p.model !== null && p.real !== null);
  if (calibration.length < MIN_CALIBRATION_BLOCKS) return snapped;

  const fx = fitAxis(calibration.flatMap(({ model, real }) => [[model[0], real[0]], [model[2], real[2]]] as [number, number][]));
  const fy = fitAxis(calibration.flatMap(({ model, real }) => [[model[1], real[1]], [model[3], real[3]]] as [number, number][]));
  const apply = (fit: AxisFit, v: number) => round4(clamp01(fit.scale * v + fit.offset));

  return snapped.map((b, index) => {
    if (assigned[index].length > 0 || !b.box) return b;
    const box: Box = [apply(fx, b.box[0]), apply(fy, b.box[1]), apply(fx, b.box[2]), apply(fy, b.box[3])];
    return box[0] < box[2] && box[1] < box[3] ? { ...b, box } : b;
  });
}

// a..z, aa..az, ba.. — the labels the answer model sees for a source's blocks.
export function blockLabel(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(97 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function blockIndexFromLabel(label: string): number | null {
  if (!/^[a-z]+$/.test(label)) return null;
  let index = 0;
  for (const char of label) index = index * 26 + (char.charCodeAt(0) - 96);
  return index - 1;
}

const SEPARATOR = "\n\n";

function boxOf(blocks: StoredBlock[]): Box | null {
  const boxes = blocks.map((b) => b.box).filter((box): box is Box => box !== null);
  return boxes.length > 0 ? unionBoxes(boxes) : null;
}

// Packs whole blocks into chunks of at most maxChars, page by page. A heading
// never ends a chunk when it can open the next one; a block longer than
// maxChars is split like plain text, every piece pointing at that block.
export function chunkBlocks(blocks: StoredBlock[], maxChars: number): BlockChunk[] {
  const sorted = [...blocks].sort((a, b) => a.pageNumber - b.pageNumber || a.ordinal - b.ordinal);
  const chunks: BlockChunk[] = [];

  let page: number | null = null;
  let offset = 0;
  let current: { block: StoredBlock; start: number }[] = [];

  const length = (items: { block: StoredBlock }[]) =>
    items.reduce((sum, item) => sum + item.block.text.length, 0) + SEPARATOR.length * Math.max(0, items.length - 1);

  const emit = (items: { block: StoredBlock; start: number }[]) => {
    if (items.length === 0 || page === null) return;
    const last = items[items.length - 1];
    chunks.push({
      text: items.map((item) => item.block.text).join(SEPARATOR),
      start: items[0].start,
      end: last.start + last.block.text.length,
      pageNumber: page,
      blockIds: items.map((item) => item.block.id),
      highlightBox: boxOf(items.map((item) => item.block)),
    });
  };

  const flush = () => {
    const last = current[current.length - 1];
    if (current.length > 1 && last.block.type === "heading") {
      emit(current.slice(0, -1));
      current = [last];
    } else {
      emit(current);
      current = [];
    }
  };

  for (const block of sorted) {
    if (block.pageNumber !== page) {
      emit(current);
      current = [];
      page = block.pageNumber;
      offset = 0;
    }
    const start = offset;
    offset += block.text.length + SEPARATOR.length;

    if (block.text.length > maxChars) {
      emit(current);
      current = [];
      for (const piece of chunkText(block.text, maxChars, OVERSIZED_BLOCK_OVERLAP)) {
        chunks.push({
          text: piece.text,
          start: start + piece.start,
          end: start + piece.end,
          pageNumber: block.pageNumber,
          blockIds: [block.id],
          highlightBox: block.box,
        });
      }
      continue;
    }

    if (current.length > 0 && length([...current, { block }]) > maxChars) {
      flush();
      if (current.length > 0 && length([...current, { block }]) > maxChars) {
        emit(current);
        current = [];
      }
    }
    current.push({ block, start });
  }
  emit(current);
  return chunks;
}
