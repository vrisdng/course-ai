// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  convertOfficeDocument,
  convertedPdfPath,
  createConverterClient,
  isConvertibleOffice,
  type OfficeConversionDeps,
} from "./officeConversion.ts";

const MATERIAL = "11111111-2222-3333-4444-555555555555";

describe("isConvertibleOffice", () => {
  it("covers Word and PowerPoint documents only", () => {
    expect(isConvertibleOffice("docx")).toBe(true);
    expect(isConvertibleOffice("pptx")).toBe(true);
    expect(isConvertibleOffice("pdf")).toBe(false);
    expect(isConvertibleOffice("doc")).toBe(false);
    expect(isConvertibleOffice("")).toBe(false);
  });
});

describe("convertedPdfPath", () => {
  it("places the PDF under converted/<material>.pdf", () => {
    expect(convertedPdfPath(MATERIAL)).toBe(`converted/${MATERIAL}.pdf`);
  });
});

describe("convertOfficeDocument", () => {
  function deps() {
    return {
      createDownloadUrl: vi.fn(async (path: string) => `https://storage.test/sign/${path}?token=d`),
      createUploadUrl: vi.fn(async (path: string) => `https://storage.test/upload/${path}?token=u`),
      callConverter: vi.fn(async () => ({ bytes: 1234, convertMs: 900 })),
    } satisfies OfficeConversionDeps;
  }

  it("signs the original and the PDF destination, converts, and returns the PDF path", async () => {
    const d = deps();

    const pdfPath = await convertOfficeDocument(MATERIAL, "course/abc-notes.docx", "docx", d);

    expect(pdfPath).toBe(`converted/${MATERIAL}.pdf`);
    expect(d.createDownloadUrl).toHaveBeenCalledWith("course/abc-notes.docx");
    expect(d.createUploadUrl).toHaveBeenCalledWith(`converted/${MATERIAL}.pdf`);
    expect(d.callConverter).toHaveBeenCalledWith({
      sourceUrl: "https://storage.test/sign/course/abc-notes.docx?token=d",
      uploadUrl: `https://storage.test/upload/converted/${MATERIAL}.pdf?token=u`,
      format: "docx",
    });
  });

  it("propagates converter failures to the caller", async () => {
    const d = deps();
    d.callConverter.mockRejectedValueOnce(new Error("Converter returned 422: LibreOffice produced no PDF"));
    await expect(convertOfficeDocument(MATERIAL, "c/x.pptx", "pptx", d)).rejects.toThrow("LibreOffice produced no PDF");
  });
});

describe("createConverterClient", () => {
  it("posts with the shared secret and returns the parsed body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ bytes: 10, convertMs: 5 })));
    const call = createConverterClient("https://conv.test/convert", "s3cret", fetchImpl);
    const body = { sourceUrl: "s", uploadUrl: "u", format: "pptx" as const };

    await expect(call(body)).resolves.toEqual({ bytes: 10, convertMs: 5 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://conv.test/convert",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer s3cret", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  });

  it("throws with the converter's error message", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    const call = createConverterClient("https://conv.test/convert", "s3cret", fetchImpl);
    await expect(call({ sourceUrl: "s", uploadUrl: "u", format: "docx" })).rejects.toThrow("Converter returned 401: Unauthorized");
  });
});
