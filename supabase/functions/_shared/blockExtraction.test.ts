// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { BLOCK_PAGES_PER_CALL, initialBlockExtractionState, runBlockExtractionBatch, type BlockExtractionDeps } from "./blockExtraction.ts";
import type { ExtractedBlock } from "./blocks.ts";

class FakeTimeout extends Error {}

function deps(output: string) {
  const saved: ExtractedBlock[] = [];
  const d = {
    loadPageImage: vi.fn(async (pageNumber: number) => ({ base64Data: `img${pageNumber}`, mimeType: "image/webp" })),
    loadPageLines: vi.fn(async (pageNumbers: number[]) => new Map(pageNumbers.map((n) => [n, n === 1 ? [{ text: "Open addressing stores keys", box: [0.1, 0.1, 0.9, 0.12] as [number, number, number, number] }] : []]))),
    readBlocks: vi.fn(async () => output),
    saveBlocks: vi.fn(async (blocks: ExtractedBlock[]) => {
      saved.push(...blocks);
    }),
    isTimeout: (error: unknown) => error instanceof FakeTimeout,
  } satisfies BlockExtractionDeps;
  return { d, saved };
}

describe("initialBlockExtractionState", () => {
  it("starts at page 1 with the image batch size, capped to the page count", () => {
    expect(initialBlockExtractionState(40)).toEqual({ nextPage: 1, totalPages: 40, pagesPerCall: BLOCK_PAGES_PER_CALL });
    expect(initialBlockExtractionState(2).pagesPerCall).toBe(2);
  });
});

describe("runBlockExtractionBatch", () => {
  const output = [
    "[Page 1]",
    '{"type":"paragraph","box":[100,130,900,150],"text":"Open addressing stores keys"}',
    "[Page 2]",
    '{"type":"heading","box":[100,50,500,80],"text":"Linear probing"}',
  ].join("\n");

  it("sends the batch's page images, then saves the parsed blocks snapped to the text layer", async () => {
    const { d, saved } = deps(output);

    const result = await runBlockExtractionBatch({ nextPage: 1, totalPages: 2, pagesPerCall: 6 }, d);

    expect(d.loadPageImage.mock.calls.map(([n]) => n)).toEqual([1, 2]);
    expect(d.readBlocks).toHaveBeenCalledWith(expect.stringContaining("pages 1 to 2"), [
      { pageNumber: 1, base64Data: "img1", mimeType: "image/webp" },
      { pageNumber: 2, base64Data: "img2", mimeType: "image/webp" },
    ]);
    expect(saved).toEqual([
      // Snapped onto the real line (model said 0.13-0.15).
      { pageNumber: 1, ordinal: 0, type: "paragraph", text: "Open addressing stores keys", box: [0.1, 0.1, 0.9, 0.12] },
      { pageNumber: 2, ordinal: 0, type: "heading", text: "Linear probing", box: [0.1, 0.05, 0.5, 0.08] },
    ]);
    expect(result).toEqual({ state: { nextPage: 3, totalPages: 2, pagesPerCall: 6 }, done: true, timedOut: false, blockCount: 2 });
  });

  it("moves to the next batch when pages remain", async () => {
    const { d } = deps('[Page 1]\n{"type":"heading","box":[0,0,10,10],"text":"One"}');
    const result = await runBlockExtractionBatch({ nextPage: 1, totalPages: 5, pagesPerCall: 1 }, d);
    expect(result.state.nextPage).toBe(2);
    expect(result.done).toBe(false);
  });

  it("shrinks the batch after a timeout instead of failing", async () => {
    const { d } = deps(output);
    d.readBlocks.mockRejectedValueOnce(new FakeTimeout("slow"));
    const result = await runBlockExtractionBatch({ nextPage: 1, totalPages: 8, pagesPerCall: 8 }, d);
    expect(result).toEqual({ state: { nextPage: 1, totalPages: 8, pagesPerCall: 4 }, done: false, timedOut: true, blockCount: 0 });
    expect(d.saveBlocks).not.toHaveBeenCalled();
  });

  it("fails when the model returns no readable blocks for the batch", async () => {
    const { d } = deps("Sorry, I can't help with that.");
    await expect(runBlockExtractionBatch({ nextPage: 1, totalPages: 1, pagesPerCall: 6 }, d)).rejects.toThrow(
      "No blocks could be read from pages 1-1",
    );
  });

  it("rethrows a timeout once the batch can't shrink further", async () => {
    const { d } = deps(output);
    d.readBlocks.mockRejectedValueOnce(new FakeTimeout("slow"));
    await expect(runBlockExtractionBatch({ nextPage: 1, totalPages: 8, pagesPerCall: 2 }, d)).rejects.toThrow("slow");
  });
});
