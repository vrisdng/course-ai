import { describe, expect, it } from "vitest";

import {
  formatLabelledBlocks,
  clipText,
  extractCitedImageTokens,
  formatTimestamp,
  IMAGE_MATERIAL_TYPES,
  normalizeCitationTokens,
  rewriteImageTokens,
  sanitizeAndRemapCitations,
  sourceLabel,
  stripTrailingSourcesSection,
} from "./citations.ts";

describe("clipText", () => {
  it("returns the string unchanged when under the limit", () => {
    expect(clipText("short", 10)).toBe("short");
  });

  it("truncates and appends an ellipsis when over the limit", () => {
    expect(clipText("0123456789ABC", 10)).toBe("0123456789...");
  });
});

describe("formatTimestamp", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatTimestamp(65_000)).toBe("1:05");
  });

  it("formats hour-plus durations as h:mm:ss", () => {
    expect(formatTimestamp(3_661_000)).toBe("1:01:01");
  });

  it("clamps negative input to zero", () => {
    expect(formatTimestamp(-500)).toBe("0:00");
  });
});

describe("sourceLabel", () => {
  it("labels video chunks with a timestamp range", () => {
    const label = sourceLabel({
      material_name: "Lecture 3",
      chunk_text: "",
      start_ms: 60_000,
      end_ms: 90_000,
      page_number: null,
    });
    expect(label).toBe("Lecture 3 (1:00-1:30)");
  });

  it("labels document chunks with a page number", () => {
    const label = sourceLabel({
      document_name: "Notes.pdf",
      chunk_text: "",
      start_ms: null,
      end_ms: null,
      page_number: 4,
    });
    expect(label).toBe("Notes.pdf (Page 4)");
  });

  it("falls back to 'Unknown document' when no name is present", () => {
    const label = sourceLabel({ chunk_text: "", start_ms: null, end_ms: null, page_number: null });
    expect(label).toBe("Unknown document");
  });
});

describe("stripTrailingSourcesSection", () => {
  it("removes a trailing markdown Sources heading and everything after it", () => {
    const input = "The answer is 42.\n\n## Sources\n1. Some doc";
    expect(stripTrailingSourcesSection(input)).toBe("The answer is 42.");
  });

  it("leaves text with no sources section untouched", () => {
    expect(stripTrailingSourcesSection("Just an answer.")).toBe("Just an answer.");
  });
});

describe("normalizeCitationTokens", () => {
  it("keeps in-range <<cite:n>> tokens as-is", () => {
    expect(normalizeCitationTokens("See <<cite:1>>.", 2)).toBe("See <<cite:1>>.");
  });

  it("drops <<cite:n>> tokens above the max source number", () => {
    expect(normalizeCitationTokens("See <<cite:5>>.", 2)).toBe("See .");
  });

  it("leaves [n] and (n) as plain text, so maths like w^{(3)} is never turned into a citation", () => {
    const answer = "Integrate $$\\int N_i EI w^{(4)} dx$$ twice; see [1] and O(1).";
    expect(normalizeCitationTokens(answer, 4)).toBe(answer);
  });

  it("splits a token listing several sources into one token per source", () => {
    expect(normalizeCitationTokens("Claim <<cite:2,3,5>>.", 5)).toBe("Claim <<cite:2>><<cite:3>><<cite:5>>.");
    expect(normalizeCitationTokens("Claim << cite: 1 , 9 >>.", 2)).toBe("Claim <<cite:1>>.");
  });
});

describe("normalizeCitationTokens with block labels", () => {
  const blocks = (source: number) => ({ 1: 2, 2: 3 } as Record<number, number>)[source] ?? 0;

  it("keeps valid block labels, lowercased and sorted", () => {
    expect(normalizeCitationTokens("See <<cite:2b>>.", 2, blocks)).toBe("See <<cite:2b>>.");
    expect(normalizeCitationTokens("See <<cite: 2C, 2B >>.", 2, blocks)).toBe("See <<cite:2b,2c>>.");
  });

  it("falls back to the whole source for labels that don't exist", () => {
    expect(normalizeCitationTokens("See <<cite:2z>>.", 2, blocks)).toBe("See <<cite:2>>.");
    expect(normalizeCitationTokens("See <<cite:2b>>.", 2)).toBe("See <<cite:2>>.");
  });

  it("splits a token that names several sources into one token per source", () => {
    expect(normalizeCitationTokens("See <<cite:1a,2b>>.", 2, blocks)).toBe("See <<cite:1a>><<cite:2b>>.");
  });

  it("lets a whole-source citation win over blocks of it in the same marker", () => {
    expect(normalizeCitationTokens("See <<cite:2,2b>>.", 2, blocks)).toBe("See <<cite:2>>.");
    expect(normalizeCitationTokens("See <<cite:2b,2>>.", 2, blocks)).toBe("See <<cite:2>>.");
  });

  it("drops references to sources that don't exist", () => {
    expect(normalizeCitationTokens("See <<cite:9a>>.", 2, blocks)).toBe("See .");
  });
});

describe("normalizeCitationTokens with block labels", () => {
  const blocks = (source: number) => ({ 1: 2, 2: 3 } as Record<number, number>)[source] ?? 0;

  it("keeps valid block labels, lowercased and sorted", () => {
    expect(normalizeCitationTokens("See <<cite:2b>>.", 2, blocks)).toBe("See <<cite:2b>>.");
    expect(normalizeCitationTokens("See <<cite: 2C, 2B >>.", 2, blocks)).toBe("See <<cite:2b,2c>>.");
  });

  it("falls back to the whole source for labels that don't exist", () => {
    expect(normalizeCitationTokens("See <<cite:2z>>.", 2, blocks)).toBe("See <<cite:2>>.");
    expect(normalizeCitationTokens("See <<cite:2b>>.", 2)).toBe("See <<cite:2>>.");
  });

  it("splits a token that names several sources into one token per source", () => {
    expect(normalizeCitationTokens("See <<cite:1a,2b>>.", 2, blocks)).toBe("See <<cite:1a>><<cite:2b>>.");
  });

  it("lets a whole-source citation win over blocks of it in the same marker", () => {
    expect(normalizeCitationTokens("See <<cite:2,2b>>.", 2, blocks)).toBe("See <<cite:2>>.");
    expect(normalizeCitationTokens("See <<cite:2b,2>>.", 2, blocks)).toBe("See <<cite:2>>.");
  });

  it("drops references to sources that don't exist", () => {
    expect(normalizeCitationTokens("See <<cite:9a>>.", 2, blocks)).toBe("See .");
  });
});

describe("sanitizeAndRemapCitations", () => {
  it("remaps cited sources to a dense 1..n sequence in first-appearance order", () => {
    const result = sanitizeAndRemapCitations(
      "First claim <<cite:3>>. Second claim <<cite:1>>.",
      3
    );
    expect(result.text).toBe("First claim <<cite:1>>. Second claim <<cite:2>>.");
    expect(result.citedChunkNumbers).toEqual([3, 1]);
  });

  it("collapses repeated citations of the same source to one mapped number", () => {
    const result = sanitizeAndRemapCitations(
      "Claim <<cite:2>>, again <<cite:2>>.",
      2
    );
    expect(result.text).toBe("Claim <<cite:1>>, again <<cite:1>>.");
    expect(result.citedChunkNumbers).toEqual([2]);
  });

  it("drops a trailing Sources section before remapping", () => {
    const result = sanitizeAndRemapCitations(
      "Answer <<cite:1>>.\n\nSources:\n[1] Doc",
      1
    );
    expect(result.text).toBe("Answer <<cite:1>>.");
  });

  it("gives each distinct set of cited blocks its own number, reusing it on repeats", () => {
    const blocks = () => 4;
    const result = sanitizeAndRemapCitations(
      "A <<cite:3b>>. B <<cite:3c>>. C <<cite:1>>. D <<cite:3b>>.",
      3,
      blocks,
    );
    expect(result.text).toBe("A <<cite:1>>. B <<cite:2>>. C <<cite:3>>. D <<cite:1>>.");
    expect(result.citedRefs).toEqual([
      { sourceNumber: 3, blockIndexes: [1] },
      { sourceNumber: 3, blockIndexes: [2] },
      { sourceNumber: 1, blockIndexes: [] },
    ]);
    expect(result.citedChunkNumbers).toEqual([3, 3, 1]);
  });

  it("treats the same blocks in a different order as one citation", () => {
    const result = sanitizeAndRemapCitations("X <<cite:2c,2b>>. Y <<cite:2b,2c>>.", 2, () => 3);
    expect(result.text).toBe("X <<cite:1>>. Y <<cite:1>>.");
    expect(result.citedRefs).toEqual([{ sourceNumber: 2, blockIndexes: [1, 2] }]);
  });

  it("reports whole-source citations with no block indexes", () => {
    const result = sanitizeAndRemapCitations("First <<cite:3>>. Second <<cite:1>>.", 3);
    expect(result.citedRefs).toEqual([
      { sourceNumber: 3, blockIndexes: [] },
      { sourceNumber: 1, blockIndexes: [] },
    ]);
  });

  it("produces no citations when the answer cites nothing", () => {
    const result = sanitizeAndRemapCitations("No citations here.", 3);
    expect(result.citedChunkNumbers).toEqual([]);
    expect(result.text).toBe("No citations here.");
  });
});

describe("formatLabelledBlocks", () => {
  it("prefixes each block with its source number and label", () => {
    expect(formatLabelledBlocks(3, ["Hashing", "A hash function maps keys to slots."], 1300)).toEqual({
      text: "[3a] Hashing\n[3b] A hash function maps keys to slots.",
      shownCount: 2,
    });
  });

  it("stops at the first block over budget, but always shows the first", () => {
    expect(formatLabelledBlocks(1, ["x".repeat(30), "y".repeat(30), "z"], 40)).toEqual({
      text: `[1a] ${"x".repeat(30)}`,
      shownCount: 1,
    });
    expect(formatLabelledBlocks(1, ["z".repeat(80)], 40).text).toBe(`[1a] ${"z".repeat(40)}...`);
  });
});

describe("extractCitedImageTokens", () => {
  it("captures source numbers and captions from image tokens", () => {
    const tokens = extractCitedImageTokens(
      "See ![the graph](img-source-2) here and ![legend](img-source-5).",
    );
    expect(tokens.get(2)).toBe("the graph");
    expect(tokens.get(5)).toBe("legend");
    expect(tokens.size).toBe(2);
  });

  it("returns an empty map when there are no image tokens", () => {
    expect(extractCitedImageTokens("plain text with <<cite:1>>").size).toBe(0);
  });
});

describe("rewriteImageTokens", () => {
  it("replaces tokens with the resolver output", () => {
    const rewritten = rewriteImageTokens(
      "a img-source-1 b img-source-3 c",
      (n) => (n === 1 ? "course-materials/a.png" : null),
    );
    expect(rewritten).toBe("a course-materials/a.png b img-source-3 c");
  });

  it("leaves a token untouched when the resolver returns null", () => {
    expect(rewriteImageTokens("img-source-9", () => null)).toBe("img-source-9");
  });

  it("leaves non-numeric tokens untouched", () => {
    expect(rewriteImageTokens("img-source-abc", () => "x")).toBe("img-source-abc");
  });
});

describe("IMAGE_MATERIAL_TYPES", () => {
  it("covers the common image upload formats", () => {
    expect(IMAGE_MATERIAL_TYPES.has("png")).toBe(true);
    expect(IMAGE_MATERIAL_TYPES.has("jpg")).toBe(true);
    expect(IMAGE_MATERIAL_TYPES.has("jpeg")).toBe(true);
    expect(IMAGE_MATERIAL_TYPES.has("webp")).toBe(true);
    expect(IMAGE_MATERIAL_TYPES.has("gif")).toBe(true);
    expect(IMAGE_MATERIAL_TYPES.has("pdf")).toBe(false);
    expect(IMAGE_MATERIAL_TYPES.has("mp4")).toBe(false);
  });
});
