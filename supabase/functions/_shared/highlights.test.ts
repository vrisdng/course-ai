import { describe, expect, it } from "vitest";

import { matchChunkToLines, tokenize, unionBoxes, type PageLine } from "./highlights.ts";

// A slide laid out top to bottom: title, three bullets, a footer.
const lines: PageLine[] = [
  { text: "Lecture 7: Dynamic Programming", box: [0.05, 0.02, 0.6, 0.08] },
  { text: "Optimal substructure: OPT(v) built from OPT(u)", box: [0.05, 0.15, 0.55, 0.19] },
  { text: "Overlapping subproblems memoise results", box: [0.05, 0.2, 0.5, 0.24] },
  { text: "Bellman-Ford relaxes every edge |V|-1 times", box: [0.05, 0.25, 0.52, 0.29] },
  { text: "17 / 42", box: [0.9, 0.95, 0.97, 0.98] },
];

describe("tokenize", () => {
  it("lowercases, strips punctuation and markdown, and splits on whitespace", () => {
    expect(tokenize("**Optimal** sub-structure: OPT(v)!")).toEqual(["optimal", "sub", "structure", "opt", "v"]);
  });

  it("folds accents and ligatures so OCR and text-layer spellings agree", () => {
    expect(tokenize("Café ﬁnal")).toEqual(["cafe", "final"]);
  });
});

describe("unionBoxes", () => {
  it("returns the smallest box covering all inputs", () => {
    expect(unionBoxes([[0.1, 0.2, 0.3, 0.4], [0.05, 0.3, 0.2, 0.5]])).toEqual([0.05, 0.2, 0.3, 0.5]);
  });
});

describe("matchChunkToLines", () => {
  it("boxes the lines a chunk covers", () => {
    const chunk = "Optimal substructure: OPT(v) built from OPT(u). Overlapping subproblems memoise results.";
    expect(matchChunkToLines(chunk, lines)).toEqual([0.05, 0.15, 0.55, 0.24]);
  });

  it("tolerates OCR formatting that differs from the text layer", () => {
    const ocr = "- **Overlapping subproblems** → memoise results\n- Bellman–Ford relaxes every edge |V|−1 times";
    expect(matchChunkToLines(ocr, lines)).toEqual([0.05, 0.2, 0.52, 0.29]);
  });

  it("bridges a single unmatched line between matched ones", () => {
    const chunk = "Optimal substructure: OPT(v) built from OPT(u). Bellman-Ford relaxes every edge |V|-1 times";
    expect(matchChunkToLines(chunk, lines)).toEqual([0.05, 0.15, 0.55, 0.29]);
  });

  it("keeps the strongest run when matches are far apart", () => {
    const spread: PageLine[] = [
      { text: "dynamic programming stores results", box: [0, 0.1, 0.5, 0.12] },
      { text: "unrelated one", box: [0, 0.2, 0.5, 0.22] },
      { text: "unrelated two", box: [0, 0.3, 0.5, 0.32] },
      { text: "bellman ford relaxes every edge repeatedly", box: [0, 0.4, 0.5, 0.42] },
      { text: "and detects negative cycles afterwards", box: [0, 0.45, 0.5, 0.47] },
    ];
    const chunk = "Dynamic programming stores results. Bellman Ford relaxes every edge repeatedly and detects negative cycles afterwards.";
    expect(matchChunkToLines(chunk, spread)).toEqual([0, 0.4, 0.5, 0.47]);
  });

  it("does not let short lines like page numbers start a match on their own", () => {
    expect(matchChunkToLines("17 42", lines)).toBeNull();
  });

  it("returns null when nothing on the page matches", () => {
    expect(matchChunkToLines("Completely different content about databases", lines)).toBeNull();
  });

  it("returns null for a page without a text layer", () => {
    expect(matchChunkToLines("Optimal substructure", [])).toBeNull();
  });
});
