// Request contract and caller check for the page renderer. Only the
// process-material-job edge function calls it; it proves itself with a shared
// secret and hands over short-lived signed storage URLs, so this function never
// holds Supabase credentials.
import { timingSafeEqual } from "node:crypto";

import type { PageLine } from "./textLines.js";

export const DEFAULT_RENDER_WIDTH = 1400;
export const MIN_RENDER_WIDTH = 200;
export const MAX_RENDER_WIDTH = 2400;
// Keeps one call well inside the caller's own wall-clock budget.
export const MAX_PAGES_PER_REQUEST = 25;

export interface RenderPageTarget {
  pageNumber: number;
  // Signed upload URL (PUT) for this page's image.
  uploadUrl: string;
}

export interface RenderPdfPagesRequest {
  // Signed download URL for the source PDF.
  pdfUrl: string;
  pages: RenderPageTarget[];
  width: number;
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

export interface RenderPdfPagesResponse {
  pageCount: number;
  pages: RenderedPage[];
  failed: FailedPage[];
}

export type ParseResult =
  | { ok: true; request: RenderPdfPagesRequest }
  | { ok: false; error: string };

export function isAuthorized(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  const given = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function isUrlAtOrigin(value: unknown, origin: string): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new URL(value).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function fail(error: string): ParseResult {
  return { ok: false, error };
}

export function parseRenderRequest(body: unknown, storageOrigin: string): ParseResult {
  if (typeof body !== "object" || body === null) {
    return fail("Body must be a JSON object");
  }
  const { pdfUrl, pages, width = DEFAULT_RENDER_WIDTH } = body as Record<string, unknown>;

  if (!isUrlAtOrigin(pdfUrl, storageOrigin)) {
    return fail("pdfUrl must point at the storage origin");
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    return fail("pages must be a non-empty array");
  }
  if (pages.length > MAX_PAGES_PER_REQUEST) {
    return fail(`At most ${MAX_PAGES_PER_REQUEST} pages per request`);
  }
  if (typeof width !== "number" || !Number.isInteger(width) || width < MIN_RENDER_WIDTH || width > MAX_RENDER_WIDTH) {
    return fail(`width must be an integer between ${MIN_RENDER_WIDTH} and ${MAX_RENDER_WIDTH}`);
  }

  const seen = new Set<number>();
  const targets: RenderPageTarget[] = [];
  for (const page of pages as unknown[]) {
    const { pageNumber, uploadUrl } = (page ?? {}) as Record<string, unknown>;
    if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) {
      return fail("pageNumber must be a positive integer");
    }
    if (seen.has(pageNumber)) {
      return fail(`Page ${pageNumber} is listed twice`);
    }
    if (!isUrlAtOrigin(uploadUrl, storageOrigin)) {
      return fail("uploadUrl must point at the storage origin");
    }
    seen.add(pageNumber);
    targets.push({ pageNumber, uploadUrl });
  }

  return { ok: true, request: { pdfUrl, pages: targets, width } };
}
