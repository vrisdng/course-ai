// POST /api/render-pdf-pages: renders a batch of PDF pages to WebP, uploads
// each to the signed upload URL it was given, and returns every page's text
// lines for citation highlighting. Called only by the process-material-job
// edge function, authenticated with RENDER_SERVICE_SECRET. See
// _lib/renderRequest.ts for the contract.
import { openPdf, type OpenedPdf } from "./_lib/renderPdf.js";
import {
  isAuthorized,
  parseRenderRequest,
  type FailedPage,
  type RenderedPage,
  type RenderPdfPagesResponse,
} from "./_lib/renderRequest.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function storageOrigin(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || undefined;
}

async function uploadImage(uploadUrl: string, image: Uint8Array): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/webp", "x-upsert": "true", "cache-control": "max-age=31536000" },
    body: image,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), process.env.RENDER_SERVICE_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const origin = storageOrigin();
  if (!origin) {
    return json({ error: "SUPABASE_URL is not configured" }, 500);
  }

  const body = await request.json().catch(() => null);
  const parsed = parseRenderRequest(body, origin);
  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }
  const { pdfUrl, pages: targets, width } = parsed.request;

  const download = await fetch(pdfUrl);
  if (!download.ok) {
    return json({ error: `PDF download failed with status ${download.status}` }, 502);
  }

  let pdf: OpenedPdf;
  try {
    pdf = await openPdf(new Uint8Array(await download.arrayBuffer()));
  } catch (error) {
    return json({ error: `Unreadable PDF: ${error instanceof Error ? error.message : String(error)}` }, 422);
  }

  const pages: RenderedPage[] = [];
  const failed: FailedPage[] = [];
  try {
    // Sequential on purpose: one page's canvas in memory at a time.
    for (const { pageNumber, uploadUrl } of targets) {
      if (pageNumber > pdf.pageCount) {
        failed.push({ pageNumber, error: `Page ${pageNumber} is past the end of the document (${pdf.pageCount} pages)` });
        continue;
      }
      try {
        const rendered = await pdf.renderPage(pageNumber, width);
        await uploadImage(uploadUrl, rendered.image);
        pages.push({ pageNumber, width: rendered.width, height: rendered.height, lines: rendered.lines });
      } catch (error) {
        failed.push({ pageNumber, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await pdf.close();
  }

  const response: RenderPdfPagesResponse = { pageCount: pdf.pageCount, pages, failed };
  return json(response);
}
