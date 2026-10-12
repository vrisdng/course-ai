import { describe, expect, it } from "vitest";

import { tokenize, unionBoxes } from "./highlights.ts";

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
