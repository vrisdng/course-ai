import { describe, expect, it } from "vitest";

import {
  BLOCK_TYPES,
  blockIndexFromLabel,
  blockLabel,
  buildBlockExtractionPrompt,
  chunkBlocks,
  parseBlockOutput,
  snapBlocksToLines,
  type ExtractedBlock,
  type StoredBlock,
} from "./blocks.ts";
import type { PageLine } from "./highlights.ts";

describe("buildBlockExtractionPrompt", () => {
  it("asks for every block type, 0-1000 boxes, LaTeX maths and the page range", () => {
    const prompt = buildBlockExtractionPrompt({ start: 3, end: 5 });
    for (const type of BLOCK_TYPES) expect(prompt).toContain(type);
    expect(prompt).toContain("0-1000");
    expect(prompt).toContain("LaTeX");
    expect(prompt).toContain("[Page 3]");
    expect(prompt).toContain("pages 3 to 5");
  });
});

describe("parseBlockOutput", () => {
  const raw = [
    "[Page 2]",
    '{"type":"heading","box":[100,50,600,80],"text":"Hashing"}',
    '{"type":"paragraph","box":[100,90,900,200],"text":"A hash function maps keys to slots."}',
    "[Page 3]",
    '{"type":"equation","box":[200,100,800,140],"text":"$$h(k) = k \\\\bmod m$$"}',
    "not json, but still content",
    '{"type":"mystery","box":[0,0,10,10],"text":"Unknown type becomes a paragraph"}',
    '{"type":"figure","box":[900,900,100,100],"text":"Inverted box is dropped"}',
    '{"type":"paragraph","text":""}',
  ].join("\n");

  it("reads blocks per page in order, scaling boxes to page fractions", () => {
    const blocks = parseBlockOutput(raw, { start: 2, end: 3 });
    expect(blocks.slice(0, 3)).toEqual([
      { pageNumber: 2, ordinal: 0, type: "heading", text: "Hashing", box: [0.1, 0.05, 0.6, 0.08] },
      { pageNumber: 2, ordinal: 1, type: "paragraph", text: "A hash function maps keys to slots.", box: [0.1, 0.09, 0.9, 0.2] },
      { pageNumber: 3, ordinal: 0, type: "equation", text: "$$h(k) = k \\bmod m$$", box: [0.2, 0.1, 0.8, 0.14] },
    ]);
  });

  it("keeps non-JSON lines and unknown types as paragraphs, and drops bad boxes and empty text", () => {
    const blocks = parseBlockOutput(raw, { start: 2, end: 3 }).filter((b) => b.pageNumber === 3);
    expect(blocks.map((b) => [b.ordinal, b.type, b.text, b.box])).toEqual([
      [0, "equation", "$$h(k) = k \\bmod m$$", [0.2, 0.1, 0.8, 0.14]],
      [1, "paragraph", "not json, but still content", null],
      [2, "paragraph", "Unknown type becomes a paragraph", [0, 0, 0.01, 0.01]],
      [3, "figure", "Inverted box is dropped", null],
    ]);
  });

  it("re-bases pages when the model numbers the range from 1, and drops pages outside it", () => {
    const restarted = '[Page 1]\n{"type":"heading","box":[0,0,10,10],"text":"First"}\n[Page 2]\n{"type":"heading","box":[0,0,10,10],"text":"Second"}';
    expect(parseBlockOutput(restarted, { start: 9, end: 10 }).map((b) => b.pageNumber)).toEqual([9, 10]);
    const stray = '[Page 7]\n{"type":"heading","box":[0,0,10,10],"text":"Outside"}\n[Page 9]\n{"type":"heading","box":[0,0,10,10],"text":"Inside"}';
    expect(parseBlockOutput(stray, { start: 8, end: 9 }).map((b) => b.text)).toEqual(["Inside"]);
  });

  it("returns nothing when there are no page markers", () => {
    expect(parseBlockOutput("plain text only", { start: 1, end: 1 })).toEqual([]);
  });
});

const block = (ordinal: number, type: ExtractedBlock["type"], text: string, box: ExtractedBlock["box"]): ExtractedBlock => ({
  pageNumber: 1,
  ordinal,
  type,
  text,
  box,
});

describe("snapBlocksToLines", () => {
  // Real text-layer lines; the model's boxes below are ~1 line too low and a bit short.
  const lines: PageLine[] = [
    { text: "Open addressing", box: [0.1, 0.1, 0.35, 0.12] },
    { text: "Open addressing stores every key directly in", box: [0.1, 0.14, 0.9, 0.16] },
    { text: "the table array, with no lists at all.", box: [0.1, 0.17, 0.8, 0.19] },
    { text: "Linear probing tries the next slot each time", box: [0.1, 0.24, 0.88, 0.26] },
    { text: "until it finds an empty one.", box: [0.1, 0.27, 0.6, 0.29] },
    { text: "7", box: [0.48, 0.95, 0.52, 0.97] },
  ];

  it("replaces text-block boxes with the union of the real lines they contain", () => {
    const blocks = [
      block(0, "heading", "Open addressing", [0.1, 0.12, 0.36, 0.14]),
      block(1, "paragraph", "Open addressing stores every key directly in the table array, with no lists at all.", [0.1, 0.16, 0.9, 0.2]),
      block(2, "paragraph", "Linear probing tries the next slot each time until it finds an empty one.", [0.1, 0.26, 0.88, 0.3]),
    ];
    const snapped = snapBlocksToLines(blocks, lines);
    expect(snapped.map((b) => b.box)).toEqual([
      [0.1, 0.1, 0.35, 0.12],
      [0.1, 0.14, 0.9, 0.19],
      [0.1, 0.24, 0.88, 0.29],
    ]);
  });

  it("gives a repeated line to the block whose model box is nearest", () => {
    // "Open addressing" appears as a heading and inside the paragraph; the
    // heading line must go to the heading, not widen the paragraph.
    const blocks = [
      block(0, "heading", "Open addressing", [0.1, 0.11, 0.36, 0.13]),
      block(1, "paragraph", "Open addressing stores every key directly in the table array, with no lists at all.", [0.1, 0.15, 0.9, 0.2]),
    ];
    const [heading, paragraph] = snapBlocksToLines(blocks, lines);
    expect(heading.box).toEqual([0.1, 0.1, 0.35, 0.12]);
    expect(paragraph.box).toEqual([0.1, 0.14, 0.9, 0.19]);
  });

  it("shifts figure and equation boxes by the offset measured on snapped text blocks", () => {
    const blocks = [
      block(0, "heading", "Open addressing", [0.1, 0.12, 0.35, 0.14]),
      block(1, "paragraph", "Open addressing stores every key directly in the table array, with no lists at all.", [0.1, 0.16, 0.9, 0.21]),
      block(2, "paragraph", "Linear probing tries the next slot each time until it finds an empty one.", [0.1, 0.26, 0.88, 0.31]),
      block(3, "figure", "Diagram of a probe sequence", [0.2, 0.42, 0.8, 0.72]),
    ];
    const figure = snapBlocksToLines(blocks, lines)[3];
    // Text blocks were all 0.02 too low, so the figure moves up by 0.02.
    expect(figure.box![1]).toBeCloseTo(0.4, 2);
    expect(figure.box![3]).toBeCloseTo(0.7, 2);
    expect(figure.box![0]).toBeCloseTo(0.2, 2);
  });

  it("leaves boxes alone on a page without a text layer", () => {
    const blocks = [block(0, "paragraph", "Scanned text", [0.1, 0.1, 0.9, 0.2])];
    expect(snapBlocksToLines(blocks, [])).toEqual(blocks);
  });

  it("does not let short lines like page numbers attach to a block", () => {
    const blocks = [block(0, "paragraph", "Chapter 7 covers hashing in depth", [0.1, 0.1, 0.9, 0.2])];
    expect(snapBlocksToLines(blocks, lines)[0].box).toEqual([0.1, 0.1, 0.9, 0.2]);
  });
});

describe("blockLabel", () => {
  it("labels blocks a..z, then aa, ab, ...", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(blockLabel)).toEqual(["a", "b", "z", "aa", "ab", "az", "ba"]);
  });
});

describe("blockIndexFromLabel", () => {
  it("inverts blockLabel and rejects anything that isn't a label", () => {
    for (const index of [0, 1, 25, 26, 27, 51, 52, 700]) expect(blockIndexFromLabel(blockLabel(index))).toBe(index);
    expect(blockIndexFromLabel("")).toBeNull();
    expect(blockIndexFromLabel("a1")).toBeNull();
  });
});

describe("chunkBlocks", () => {
  const stored = (id: string, pageNumber: number, ordinal: number, type: StoredBlock["type"], text: string, box: StoredBlock["box"] = [0.1, 0.1 * ordinal, 0.9, 0.1 * ordinal + 0.05]): StoredBlock => ({
    id,
    pageNumber,
    ordinal,
    type,
    text,
    box,
  });

  it("packs whole blocks into chunks per page without splitting them", () => {
    const blocks = [
      stored("b1", 1, 0, "heading", "Hashing"),
      stored("b2", 1, 1, "paragraph", "x".repeat(50)),
      stored("b3", 1, 2, "paragraph", "y".repeat(50)),
      stored("b4", 2, 0, "paragraph", "z".repeat(30)),
    ];
    const chunks = chunkBlocks(blocks, 80);
    expect(chunks.map((c) => [c.pageNumber, c.blockIds])).toEqual([
      [1, ["b1", "b2"]],
      [1, ["b3"]],
      [2, ["b4"]],
    ]);
    expect(chunks[0].text).toBe(`Hashing\n\n${"x".repeat(50)}`);
  });

  it("records each chunk's offsets within its page text and the union of its block boxes", () => {
    const blocks = [
      stored("b1", 1, 0, "paragraph", "a".repeat(40), [0.1, 0.1, 0.5, 0.2]),
      stored("b2", 1, 1, "paragraph", "b".repeat(40), [0.1, 0.3, 0.9, 0.4]),
    ];
    const [first, second] = chunkBlocks(blocks, 50);
    expect([first.start, first.end, second.start, second.end]).toEqual([0, 40, 42, 82]);
    expect(first.highlightBox).toEqual([0.1, 0.1, 0.5, 0.2]);
    expect(chunkBlocks(blocks, 500)[0].highlightBox).toEqual([0.1, 0.1, 0.9, 0.4]);
  });

  it("moves a trailing heading forward so it stays with the content it introduces", () => {
    const blocks = [
      stored("b1", 1, 0, "paragraph", "p".repeat(40)),
      stored("b2", 1, 1, "heading", "Next section"),
      stored("b3", 1, 2, "paragraph", "q".repeat(40)),
    ];
    expect(chunkBlocks(blocks, 60).map((c) => c.blockIds)).toEqual([["b1"], ["b2", "b3"]]);
  });

  it("splits a single oversized block, keeping every piece pointed at it", () => {
    const blocks = [stored("big", 1, 0, "paragraph", "word ".repeat(100).trim())];
    const chunks = chunkBlocks(blocks, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.blockIds.length === 1 && c.blockIds[0] === "big")).toBe(true);
  });

  it("returns no chunks for no blocks", () => {
    expect(chunkBlocks([], 1200)).toEqual([]);
  });
});
