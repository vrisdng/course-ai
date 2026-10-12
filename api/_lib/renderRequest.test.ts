// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RENDER_WIDTH,
  MAX_PAGES_PER_REQUEST,
  isAuthorized,
  parseRenderRequest,
} from "./renderRequest.js";

const ORIGIN = "https://project.supabase.co";
const pdfUrl = `${ORIGIN}/storage/v1/object/sign/course-materials/a.pdf?token=t`;
const uploadUrl = (n: number) =>
  `${ORIGIN}/storage/v1/object/upload/sign/course-materials/page-images/m/page-${n}.webp?token=t`;

describe("isAuthorized", () => {
  it("accepts the configured secret as a bearer token", () => {
    expect(isAuthorized("Bearer s3cret-value", "s3cret-value")).toBe(true);
  });

  it("rejects a wrong, missing or differently sized token", () => {
    expect(isAuthorized("Bearer wrong-value", "s3cret-value")).toBe(false);
    expect(isAuthorized("Bearer short", "s3cret-value")).toBe(false);
    expect(isAuthorized(null, "s3cret-value")).toBe(false);
    expect(isAuthorized("s3cret-value", "s3cret-value")).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    expect(isAuthorized("Bearer ", undefined)).toBe(false);
    expect(isAuthorized("Bearer ", "")).toBe(false);
  });
});

describe("parseRenderRequest", () => {
  it("accepts a valid request and fills the default width", () => {
    const result = parseRenderRequest({ pdfUrl, pages: [{ pageNumber: 1, uploadUrl: uploadUrl(1) }] }, ORIGIN);
    expect(result).toEqual({
      ok: true,
      request: { pdfUrl, pages: [{ pageNumber: 1, uploadUrl: uploadUrl(1) }], width: DEFAULT_RENDER_WIDTH },
    });
  });

  it("rejects bodies that are not objects or lack pages", () => {
    expect(parseRenderRequest(null, ORIGIN).ok).toBe(false);
    expect(parseRenderRequest({ pdfUrl }, ORIGIN).ok).toBe(false);
    expect(parseRenderRequest({ pdfUrl, pages: [] }, ORIGIN).ok).toBe(false);
  });

  it("rejects URLs outside the storage origin", () => {
    const foreignPdf = parseRenderRequest(
      { pdfUrl: "https://evil.test/a.pdf", pages: [{ pageNumber: 1, uploadUrl: uploadUrl(1) }] },
      ORIGIN,
    );
    const foreignUpload = parseRenderRequest(
      { pdfUrl, pages: [{ pageNumber: 1, uploadUrl: "https://evil.test/up" }] },
      ORIGIN,
    );
    expect(foreignPdf).toEqual({ ok: false, error: "pdfUrl must point at the storage origin" });
    expect(foreignUpload).toEqual({ ok: false, error: "uploadUrl must point at the storage origin" });
  });

  it("rejects non-positive or fractional page numbers and duplicates", () => {
    for (const pageNumber of [0, -1, 1.5, "2"]) {
      expect(parseRenderRequest({ pdfUrl, pages: [{ pageNumber, uploadUrl: uploadUrl(1) }] }, ORIGIN).ok).toBe(false);
    }
    const duplicate = parseRenderRequest(
      { pdfUrl, pages: [{ pageNumber: 2, uploadUrl: uploadUrl(2) }, { pageNumber: 2, uploadUrl: uploadUrl(2) }] },
      ORIGIN,
    );
    expect(duplicate.ok).toBe(false);
  });

  it("caps the number of pages per request", () => {
    const pages = Array.from({ length: MAX_PAGES_PER_REQUEST + 1 }, (_, i) => ({ pageNumber: i + 1, uploadUrl: uploadUrl(i + 1) }));
    expect(parseRenderRequest({ pdfUrl, pages }, ORIGIN)).toEqual({
      ok: false,
      error: `At most ${MAX_PAGES_PER_REQUEST} pages per request`,
    });
  });

  it("rejects widths outside the supported range", () => {
    const pages = [{ pageNumber: 1, uploadUrl: uploadUrl(1) }];
    expect(parseRenderRequest({ pdfUrl, pages, width: 50 }, ORIGIN).ok).toBe(false);
    expect(parseRenderRequest({ pdfUrl, pages, width: 5000 }, ORIGIN).ok).toBe(false);
    expect(parseRenderRequest({ pdfUrl, pages, width: 800 }, ORIGIN)).toMatchObject({ ok: true, request: { width: 800 } });
  });
});
