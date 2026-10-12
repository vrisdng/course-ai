// @vitest-environment node
import { describe, expect, it } from "vitest";

import { groupTextItemsIntoLines, type PdfTextItem, type ViewportLike } from "./textLines.js";

// A 600x800pt page rendered at scale 2 (1200x1600px). pdf.js viewports flip
// the y axis: PDF y=800 (top) maps to pixel y=0.
const viewport: ViewportLike = { width: 1200, height: 1600, scale: 2, transform: [2, 0, 0, -2, 0, 1600] };

// A text run at PDF coordinates (x, baseline y) in a font of `size` points.
function item(str: string, x: number, y: number, width: number, size = 10, hasEOL = false): PdfTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width, height: size, hasEOL };
}

describe("groupTextItemsIntoLines", () => {
  it("joins runs on the same baseline into one line", () => {
    const lines = groupTextItemsIntoLines(
      [item("Dynamic", 60, 700, 40), item("programming", 104, 700, 60)],
      viewport,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Dynamic programming");
    // x0 = 60*2/1200, y0 = (1600 - 700*2 - 0.85*20)/1600, x1 = (104+60)*2/1200, y1 = (1600-1400+0.2*20)/1600
    expect(lines[0].box).toEqual([0.1, 0.1144, 0.2733, 0.1275]);
  });

  it("concatenates runs that touch without inserting a space", () => {
    const lines = groupTextItemsIntoLines([item("memo", 60, 700, 24), item("ise", 84, 700, 15)], viewport);
    expect(lines[0].text).toBe("memoise");
  });

  it("starts a new line when the baseline changes", () => {
    const lines = groupTextItemsIntoLines(
      [item("First line", 60, 700, 50), item("Second line", 60, 680, 55)],
      viewport,
    );
    expect(lines.map((l) => l.text)).toEqual(["First line", "Second line"]);
  });

  it("starts a new line after an explicit end-of-line marker", () => {
    const lines = groupTextItemsIntoLines(
      [item("Ends here", 60, 700, 45, 10, true), item("next", 120, 700, 20)],
      viewport,
    );
    expect(lines.map((l) => l.text)).toEqual(["Ends here", "next"]);
  });

  it("splits a wide horizontal jump into separate lines (two columns)", () => {
    const lines = groupTextItemsIntoLines(
      [item("Left column", 60, 700, 55), item("Right column", 400, 700, 60)],
      viewport,
    );
    expect(lines.map((l) => l.text)).toEqual(["Left column", "Right column"]);
  });

  it("skips whitespace-only runs and returns nothing for a page without text", () => {
    expect(groupTextItemsIntoLines([item("   ", 60, 700, 10)], viewport)).toEqual([]);
    expect(groupTextItemsIntoLines([], viewport)).toEqual([]);
  });

  it("clamps boxes to the page", () => {
    const [line] = groupTextItemsIntoLines([item("Bleeds off the edge", 560, 795, 100)], viewport);
    expect(line.box[2]).toBe(1);
    expect(line.box[1]).toBe(0);
  });
});
