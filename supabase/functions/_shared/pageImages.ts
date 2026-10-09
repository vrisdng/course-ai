// Page-image stage of process-material-job, the first stage for a PDF. Pages
// are rendered in batches by the Vercel renderer (api/render-pdf-pages.ts):
// this side signs a download URL for the PDF and an upload URL per page image,
// sends them over, then stores each page's size and text lines. The block
// extraction stage reads those images and snaps block boxes onto those lines.
// One batch per invocation; the caller requeues until done.
import type { PageLine } from "./highlights.ts";

export const PAGE_IMAGE_PREFIX = "page-images";
// Under the renderer's 25-page cap, and small enough that rendering plus
// uploads finish well inside this function's wall clock.
export const RENDER_BATCH_SIZE = 20;
export const RENDER_CALL_TIMEOUT_MS = 110_000;

export interface PageRenderState {
  nextPage: number;
  // Unknown until the renderer reports it on the first batch.
  totalPages: number | null;
}

// Mirrors api/_lib/renderRequest.ts.
export interface RenderRequestBody {
  pdfUrl: string;
  pages: { pageNumber: number; uploadUrl: string }[];
}

export interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
  lines: PageLine[];
}

export interface FailedPage {
  pageNumber: number;
  error: string;
}

export interface RenderResponseBody {
  pageCount: number;
  pages: RenderedPage[];
  failed: FailedPage[];
}

export interface MaterialPageRow {
  material_id: string;
  page_number: number;
  width: number;
  height: number;
  lines: PageLine[];
}

export interface PageRenderDeps {
  createPdfDownloadUrl(): Promise<string>;
  createUploadUrl(path: string): Promise<string>;
  callRenderer(body: RenderRequestBody): Promise<RenderResponseBody>;
  savePages(rows: MaterialPageRow[]): Promise<void>;
}

export interface PageRenderBatchResult {
  state: PageRenderState;
  done: boolean;
  rendered: number;
  // Pages that exist but failed to render or upload.
  failed: FailedPage[];
}

export function pageImagePath(materialId: string, pageNumber: number): string {
  return `${PAGE_IMAGE_PREFIX}/${materialId}/page-${pageNumber}.webp`;
}

export function nextRenderBatch(state: PageRenderState): number[] {
  const last = state.totalPages === null
    ? state.nextPage + RENDER_BATCH_SIZE - 1
    : Math.min(state.nextPage + RENDER_BATCH_SIZE - 1, state.totalPages);
  const pages: number[] = [];
  for (let page = state.nextPage; page <= last; page += 1) {
    pages.push(page);
  }
  return pages;
}

export async function runPageRenderBatch(
  materialId: string,
  state: PageRenderState,
  deps: PageRenderDeps,
): Promise<PageRenderBatchResult> {
  const pageNumbers = nextRenderBatch(state);
  if (pageNumbers.length === 0) {
    return { state, done: true, rendered: 0, failed: [] };
  }

  const [pdfUrl, uploadUrls] = await Promise.all([
    deps.createPdfDownloadUrl(),
    Promise.all(pageNumbers.map((page) => deps.createUploadUrl(pageImagePath(materialId, page)))),
  ]);

  const response = await deps.callRenderer({
    pdfUrl,
    pages: pageNumbers.map((pageNumber, index) => ({ pageNumber, uploadUrl: uploadUrls[index] })),
  });

  if (response.pages.length > 0) {
    await deps.savePages(
      response.pages.map((page) => ({
        material_id: materialId,
        page_number: page.pageNumber,
        width: page.width,
        height: page.height,
        lines: page.lines,
      })),
    );
  }

  const totalPages = response.pageCount;
  const nextPage = Math.min(pageNumbers[pageNumbers.length - 1] + 1, totalPages + 1);
  return {
    state: { nextPage, totalPages },
    done: nextPage > totalPages,
    rendered: response.pages.length,
    // The first batch over-asks while the page count is unknown; those are not failures.
    failed: response.failed.filter((page) => page.pageNumber <= totalPages),
  };
}

export function createRendererClient(
  url: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): (body: RenderRequestBody) => Promise<RenderResponseBody> {
  return async (body) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RENDER_CALL_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.json().then((b) => b?.error).catch(() => null);
      throw new Error(`Renderer returned ${response.status}: ${detail ?? response.statusText}`);
    }
    return (await response.json()) as RenderResponseBody;
  };
}
