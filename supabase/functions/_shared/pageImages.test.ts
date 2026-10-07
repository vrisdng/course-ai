// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  RENDER_BATCH_SIZE,
  createRendererClient,
  nextRenderBatch,
  pageImagePath,
  runPageRenderBatch,
  type PageRenderDeps,
  type RenderResponseBody,
} from "./pageImages.ts";

const MATERIAL = "11111111-2222-3333-4444-555555555555";

describe("pageImagePath", () => {
  it("places page images under page-images/<material>/", () => {
    expect(pageImagePath(MATERIAL, 3)).toBe(`page-images/${MATERIAL}/page-3.webp`);
  });
});

describe("nextRenderBatch", () => {
  it("takes a full batch while the page count is unknown", () => {
    expect(nextRenderBatch({ nextPage: 1, totalPages: null })).toEqual(
      Array.from({ length: RENDER_BATCH_SIZE }, (_, i) => i + 1),
    );
  });

  it("stops at the last page once the count is known", () => {
    expect(nextRenderBatch({ nextPage: 41, totalPages: 43 })).toEqual([41, 42, 43]);
    expect(nextRenderBatch({ nextPage: 44, totalPages: 43 })).toEqual([]);
  });
});

function deps(response: RenderResponseBody, chunks: { id: string; chunk_text: string; page_number: number | null }[] = []) {
  return {
    createPdfDownloadUrl: vi.fn(async () => "https://storage.test/pdf?token=d"),
    createUploadUrl: vi.fn(async (path: string) => `https://storage.test/upload/${path}?token=u`),
    callRenderer: vi.fn(async () => response),
    savePages: vi.fn(async () => {}),
    loadChunks: vi.fn(async () => chunks),
    saveHighlight: vi.fn(async () => {}),
  } satisfies PageRenderDeps;
}

const titleLine = { text: "Dynamic programming stores subproblem results", box: [0.1, 0.1, 0.8, 0.15] as [number, number, number, number] };

describe("runPageRenderBatch", () => {
  it("signs an upload URL per page, renders, saves pages and learns the page count", async () => {
    const d = deps({
      pageCount: 2,
      pages: [
        { pageNumber: 1, width: 1400, height: 788, lines: [titleLine] },
        { pageNumber: 2, width: 1400, height: 788, lines: [] },
      ],
      failed: Array.from({ length: RENDER_BATCH_SIZE - 2 }, (_, i) => ({
        pageNumber: i + 3,
        error: `Page ${i + 3} is past the end of the document (2 pages)`,
      })),
    });

    const result = await runPageRenderBatch(MATERIAL, { nextPage: 1, totalPages: null }, d);

    expect(d.createUploadUrl).toHaveBeenCalledTimes(RENDER_BATCH_SIZE);
    expect(d.createUploadUrl).toHaveBeenCalledWith(`page-images/${MATERIAL}/page-1.webp`);
    expect(d.callRenderer).toHaveBeenCalledWith({
      pdfUrl: "https://storage.test/pdf?token=d",
      pages: expect.arrayContaining([
        { pageNumber: 1, uploadUrl: `https://storage.test/upload/page-images/${MATERIAL}/page-1.webp?token=u` },
      ]),
    });
    expect(d.savePages).toHaveBeenCalledWith([
      { material_id: MATERIAL, page_number: 1, width: 1400, height: 788, lines: [titleLine] },
      { material_id: MATERIAL, page_number: 2, width: 1400, height: 788, lines: [] },
    ]);
    expect(result).toEqual({
      state: { nextPage: 3, totalPages: 2 },
      done: true,
      rendered: 2,
      highlighted: 0,
      failed: [],
    });
  });

  it("matches the rendered pages' chunks to their lines and saves the boxes", async () => {
    const d = deps(
      { pageCount: 30, pages: [{ pageNumber: 21, width: 1400, height: 788, lines: [titleLine] }], failed: [] },
      [
        { id: "chunk-a", chunk_text: "Dynamic programming stores subproblem results so they are reused.", page_number: 21 },
        { id: "chunk-b", chunk_text: "Nothing on the page says this.", page_number: 21 },
      ],
    );

    const result = await runPageRenderBatch(MATERIAL, { nextPage: 21, totalPages: 30 }, d);

    expect(d.loadChunks).toHaveBeenCalledWith([21]);
    expect(d.saveHighlight).toHaveBeenCalledTimes(1);
    expect(d.saveHighlight).toHaveBeenCalledWith("chunk-a", [0.1, 0.1, 0.8, 0.15]);
    expect(result.highlighted).toBe(1);
    expect(result.state).toEqual({ nextPage: 31, totalPages: 30 });
    expect(result.done).toBe(true);
  });

  it("continues when more pages remain and reports genuine page failures", async () => {
    const d = deps({
      pageCount: 50,
      pages: [{ pageNumber: 1, width: 1400, height: 788, lines: [] }],
      failed: [{ pageNumber: 2, error: "Upload failed with status 500" }],
    });

    const result = await runPageRenderBatch(MATERIAL, { nextPage: 1, totalPages: null }, d);

    expect(result.done).toBe(false);
    expect(result.state).toEqual({ nextPage: RENDER_BATCH_SIZE + 1, totalPages: 50 });
    expect(result.failed).toEqual([{ pageNumber: 2, error: "Upload failed with status 500" }]);
  });

  it("does nothing once every page is rendered", async () => {
    const d = deps({ pageCount: 0, pages: [], failed: [] });
    const result = await runPageRenderBatch(MATERIAL, { nextPage: 5, totalPages: 4 }, d);
    expect(d.callRenderer).not.toHaveBeenCalled();
    expect(result.done).toBe(true);
  });
});

describe("createRendererClient", () => {
  it("posts the batch with the shared secret and returns the parsed body", async () => {
    const body: RenderResponseBody = { pageCount: 1, pages: [], failed: [] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)));
    const call = createRendererClient("https://app.test/api/render-pdf-pages", "s3cret", fetchImpl);

    await expect(call({ pdfUrl: "p", pages: [] })).resolves.toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.test/api/render-pdf-pages",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer s3cret", "Content-Type": "application/json" },
        body: JSON.stringify({ pdfUrl: "p", pages: [] }),
      }),
    );
  });

  it("throws with the renderer's error message on a failed call", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Unreadable PDF" }), { status: 422 }));
    const call = createRendererClient("https://app.test/api/render-pdf-pages", "s3cret", fetchImpl);
    await expect(call({ pdfUrl: "p", pages: [] })).rejects.toThrow("Renderer returned 422: Unreadable PDF");
  });
});
