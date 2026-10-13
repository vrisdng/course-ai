// Groups pdf.js text runs into positioned lines. pdf.js reports text as runs
// (a word, a phrase, sometimes a single glyph) in PDF space; highlighting
// needs whole lines with boxes in page fractions, so runs on one baseline that
// follow each other are merged.

// [x0, y0, x1, y1] as fractions of the page width/height, top-left origin.
export type Box = [number, number, number, number];

export interface PageLine {
  text: string;
  box: Box;
}

// The subset of pdf.js's TextItem this module reads.
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

// The subset of pdf.js's PageViewport this module reads.
export interface ViewportLike {
  width: number;
  height: number;
  scale: number;
  transform: number[];
}

// Glyph extents relative to the font size: pdf.js gives the baseline, not the box.
const ASCENT = 0.85;
const DESCENT = 0.2;
// Runs closer than this (in font sizes) join without a space.
const JOIN_WITHOUT_SPACE = 0.15;
// Baselines within this (in font sizes) are the same line.
const SAME_BASELINE = 0.5;
// A forward jump wider than this (in font sizes) is a new column, not a space.
const MAX_WORD_GAP = 2.5;

interface PixelRun {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  fontSize: number;
}

function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function toPixelRun(item: PdfTextItem, viewport: ViewportLike): PixelRun {
  const m = multiply(viewport.transform, item.transform);
  const fontSize = Math.hypot(m[2], m[3]);
  const x0 = m[4];
  const baseline = m[5];
  return {
    text: item.str,
    x0,
    x1: x0 + item.width * viewport.scale,
    top: baseline - ASCENT * fontSize,
    bottom: baseline + DESCENT * fontSize,
    baseline,
    fontSize,
  };
}

function round4(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
}

function continuesLine(line: PixelRun, run: PixelRun): boolean {
  const size = Math.max(line.fontSize, run.fontSize);
  const sameBaseline = Math.abs(run.baseline - line.baseline) <= SAME_BASELINE * size;
  const gap = run.x0 - line.x1;
  return sameBaseline && gap >= -SAME_BASELINE * size && gap <= MAX_WORD_GAP * size;
}

export function groupTextItemsIntoLines(items: PdfTextItem[], viewport: ViewportLike): PageLine[] {
  const lines: PixelRun[] = [];
  let current: PixelRun | null = null;
  let breakBefore = false;

  for (const item of items) {
    if (item.str.trim()) {
      const run = toPixelRun(item, viewport);
      if (current && !breakBefore && continuesLine(current, run)) {
        const gap = run.x0 - current.x1;
        const joiner = gap > JOIN_WITHOUT_SPACE * current.fontSize ? " " : "";
        current.text = `${current.text}${joiner}${run.text}`;
        current.x1 = Math.max(current.x1, run.x1);
        current.top = Math.min(current.top, run.top);
        current.bottom = Math.max(current.bottom, run.bottom);
        current.fontSize = Math.max(current.fontSize, run.fontSize);
      } else {
        current = { ...run };
        lines.push(current);
      }
      breakBefore = false;
    }
    if (item.hasEOL) {
      breakBefore = true;
    }
  }

  return lines.map((line) => ({
    text: line.text.replace(/\s+/g, " ").trim(),
    box: [
      round4(line.x0 / viewport.width),
      round4(line.top / viewport.height),
      round4(line.x1 / viewport.width),
      round4(line.bottom / viewport.height),
    ],
  }));
}
