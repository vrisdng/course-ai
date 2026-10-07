// @vitest-environment node
import { describe, expect, it } from "vitest";

import { openPdf } from "./renderPdf.js";
import { buildFixturePdf } from "./testPdf.js";

const fixture = buildFixturePdf([
  {
    width: 600,
    height: 800,
    texts: [
      { text: "Dynamic Programming", x: 60, y: 720, size: 28 },
      { text: "Optimal substructure and overlapping subproblems", x: 60, y: 660, size: 14 },
    ],
  },
  { width: 800, height: 600, texts: [{ text: "Landscape page", x: 100, y: 500, size: 20 }] },
]);

describe("openPdf", () => {
  it("reports the page count", async () => {
    const pdf = await openPdf(fixture);
    try {
      expect(pdf.pageCount).toBe(2);
    } finally {
      await pdf.close();
    }
  });

  it("renders a page to WebP at the requested width, keeping the aspect ratio", async () => {
    const pdf = await openPdf(fixture);
    try {
      const page = await pdf.renderPage(1, 1200);
      expect(page.width).toBe(1200);
      expect(page.height).toBe(1600);
      // RIFF....WEBP header
      expect(Buffer.from(page.image.subarray(0, 4)).toString("ascii")).toBe("RIFF");
      expect(Buffer.from(page.image.subarray(8, 12)).toString("ascii")).toBe("WEBP");

      const landscape = await pdf.renderPage(2, 1200);
      expect(landscape.height).toBe(900);
    } finally {
      await pdf.close();
    }
  });

  it("returns each text line with a box in page fractions", async () => {
    const pdf = await openPdf(fixture);
    try {
      const { lines } = await pdf.renderPage(1, 1200);
      expect(lines.map((line) => line.text)).toEqual([
        "Dynamic Programming",
        "Optimal substructure and overlapping subproblems",
      ]);
      const [title] = lines;
      // Baseline 720pt on an 800pt page → 0.1 from the top; 28pt font ≈ 0.035 of the height.
      expect(title.box[0]).toBeCloseTo(0.1, 2);
      expect(title.box[1]).toBeCloseTo((80 - 0.85 * 28) / 800, 2);
      expect(title.box[3]).toBeCloseTo((80 + 0.2 * 28) / 800, 2);
      expect(title.box[2]).toBeGreaterThan(0.4);
      expect(title.box[2]).toBeLessThan(0.7);
    } finally {
      await pdf.close();
    }
  });

  it("rejects a page outside the document", async () => {
    const pdf = await openPdf(fixture);
    try {
      await expect(pdf.renderPage(3, 1200)).rejects.toThrow();
    } finally {
      await pdf.close();
    }
  });
});
