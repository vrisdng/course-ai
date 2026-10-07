// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isAuthorized, parseConvertRequest } from "./request.ts";

const ORIGIN = "https://project.supabase.co";
const sourceUrl = `${ORIGIN}/storage/v1/object/sign/course-materials/c/notes.docx?token=t`;
const uploadUrl = `${ORIGIN}/storage/v1/object/upload/sign/course-materials/converted/m.pdf?token=t`;

describe("isAuthorized", () => {
  it("accepts only the configured secret as a bearer token", () => {
    expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorized("Bearer nope00", "s3cret")).toBe(false);
    expect(isAuthorized("Bearer s3", "s3cret")).toBe(false);
    expect(isAuthorized("s3cret", "s3cret")).toBe(false);
    expect(isAuthorized(undefined, "s3cret")).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    expect(isAuthorized("Bearer ", "")).toBe(false);
    expect(isAuthorized("Bearer x", undefined)).toBe(false);
  });
});

describe("parseConvertRequest", () => {
  it("accepts a docx or pptx conversion between storage URLs", () => {
    for (const format of ["docx", "pptx"] as const) {
      expect(parseConvertRequest({ sourceUrl, uploadUrl, format }, ORIGIN)).toEqual({
        ok: true,
        request: { sourceUrl, uploadUrl, format },
      });
    }
  });

  it("rejects unsupported formats", () => {
    expect(parseConvertRequest({ sourceUrl, uploadUrl, format: "exe" }, ORIGIN)).toEqual({
      ok: false,
      error: "format must be docx or pptx",
    });
  });

  it("rejects URLs outside the storage origin", () => {
    expect(parseConvertRequest({ sourceUrl: "https://evil.test/a.docx", uploadUrl, format: "docx" }, ORIGIN)).toEqual({
      ok: false,
      error: "sourceUrl must point at the storage origin",
    });
    expect(parseConvertRequest({ sourceUrl, uploadUrl: "http://169.254.169.254/", format: "docx" }, ORIGIN)).toEqual({
      ok: false,
      error: "uploadUrl must point at the storage origin",
    });
  });

  it("rejects bodies that are not objects", () => {
    expect(parseConvertRequest(null, ORIGIN).ok).toBe(false);
    expect(parseConvertRequest("docx", ORIGIN).ok).toBe(false);
  });
});
