// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { citedBlockIds, citedExcerpt, loadSourceBlocks, type SourceBlocksDeps } from "./sourceBlocks.ts";

describe("loadSourceBlocks", () => {
  it("returns each chunk's blocks in the chunk's own order", async () => {
    const deps = {
      fetchChunkBlockIds: vi.fn(async () => [
        { id: "chunk-1", block_ids: ["b2", "b1"] },
        { id: "chunk-2", block_ids: null },
      ]),
      fetchBlocks: vi.fn(async () => [
        { id: "b1", text: "Second" },
        { id: "b2", text: "First" },
      ]),
    } satisfies SourceBlocksDeps;

    const blocks = await loadSourceBlocks(["chunk-1", "chunk-2"], deps);

    expect(deps.fetchBlocks).toHaveBeenCalledWith(["b2", "b1"]);
    expect(blocks.get("chunk-1")).toEqual([
      { id: "b2", text: "First" },
      { id: "b1", text: "Second" },
    ]);
    expect(blocks.has("chunk-2")).toBe(false);
  });

  it("skips blocks it cannot read and chunks with no readable blocks", async () => {
    const deps = {
      fetchChunkBlockIds: vi.fn(async () => [{ id: "chunk-1", block_ids: ["gone"] }]),
      fetchBlocks: vi.fn(async () => []),
    } satisfies SourceBlocksDeps;
    expect((await loadSourceBlocks(["chunk-1"], deps)).size).toBe(0);
  });

  it("does no lookups for no chunks", async () => {
    const deps = { fetchChunkBlockIds: vi.fn(), fetchBlocks: vi.fn() };
    expect((await loadSourceBlocks([], deps)).size).toBe(0);
    expect(deps.fetchChunkBlockIds).not.toHaveBeenCalled();
  });
});

describe("citedBlockIds / citedExcerpt", () => {
  const shown = [
    { id: "b1", text: "Heading" },
    { id: "b2", text: "The cited paragraph." },
    { id: "b3", text: "Another paragraph." },
  ];

  it("maps cited block indexes to ids, ignoring indexes that weren't shown", () => {
    expect(citedBlockIds([1, 2], shown)).toEqual(["b2", "b3"]);
    expect(citedBlockIds([7], shown)).toEqual([]);
    expect(citedBlockIds([], shown)).toEqual([]);
  });

  it("uses the cited blocks' text as the excerpt, else the chunk's", () => {
    expect(citedExcerpt([1], shown, "whole chunk text")).toBe("The cited paragraph.");
    expect(citedExcerpt([], shown, "whole chunk text")).toBe("whole chunk text");
    expect(citedExcerpt([1, 2], shown, "x")).toBe("The cited paragraph. Another paragraph.");
    expect(citedExcerpt([], [], "y".repeat(400))).toBe(`${"y".repeat(300)}...`);
  });
});
