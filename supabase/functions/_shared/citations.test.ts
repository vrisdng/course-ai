import { describe, expect, it } from "vitest";

import {
  buildCitationRewriteSourceContext,
  clipText,
  formatTimestamp,
  normalizeCitationTokens,
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

  it("converts legacy [n] markers into cite tokens when in range", () => {
    expect(normalizeCitationTokens("See [1].", 2)).toBe("See <<cite:1>>.");
  });

  it("leaves out-of-range [n] markers alone", () => {
    expect(normalizeCitationTokens("See [9].", 2)).toBe("See [9].");
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

  it("produces no citations when the answer cites nothing", () => {
    const result = sanitizeAndRemapCitations("No citations here.", 3);
    expect(result.citedChunkNumbers).toEqual([]);
    expect(result.text).toBe("No citations here.");
  });
});

describe("buildCitationRewriteSourceContext", () => {
  it("numbers sources sequentially with label and clipped text", () => {
    const context = buildCitationRewriteSourceContext([
      { material_name: "A", material_type: "pdf", chunk_text: "alpha", start_ms: null, end_ms: null, page_number: null },
      { material_name: "B", material_type: "video", chunk_text: "beta", start_ms: 0, end_ms: 1000, page_number: null },
    ]);
    expect(context).toContain("Source 1: A (pdf)");
    expect(context).toContain("Source 2: B (0:00-0:01) (video)");
    expect(context).toContain("alpha");
    expect(context).toContain("beta");
  });
});
