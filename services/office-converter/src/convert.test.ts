// @vitest-environment node
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ConversionError, convertDocument, type ConvertDeps } from "./convert.ts";

const request = {
  sourceUrl: "https://storage.test/sign/notes.docx?token=d",
  uploadUrl: "https://storage.test/upload/converted/m.pdf?token=u",
  format: "docx" as const,
};
const PDF = Buffer.from("%PDF-1.7 fake");

function deps(overrides: Partial<ConvertDeps> = {}) {
  const uploads: { url: string; headers: Headers; body: Uint8Array }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PUT") {
      uploads.push({ url: String(url), headers: new Headers(init.headers), body: init.body as Uint8Array });
      return new Response("{}");
    }
    return new Response(Buffer.from("PK docx bytes"));
  });
  const runSoffice = vi.fn(async (input: string, outDir: string) => {
    await writeFile(path.join(outDir, `${path.parse(input).name}.pdf`), PDF);
  });
  const workDir = vi.fn(() => mkdtemp(path.join(os.tmpdir(), "convert-test-")));
  return { uploads, d: { fetch: fetchImpl, runSoffice, workDir, ...overrides } satisfies ConvertDeps };
}

describe("convertDocument", () => {
  it("downloads the source, converts it with LibreOffice and uploads the PDF", async () => {
    const { uploads, d } = deps();

    const result = await convertDocument(request, d);

    expect(d.fetch).toHaveBeenCalledWith(request.sourceUrl);
    expect(d.runSoffice).toHaveBeenCalledWith(expect.stringMatching(/input\.docx$/), expect.any(String));
    expect(uploads).toHaveLength(1);
    expect(uploads[0].url).toBe(request.uploadUrl);
    expect(uploads[0].headers.get("content-type")).toBe("application/pdf");
    expect(uploads[0].headers.get("x-upsert")).toBe("true");
    expect(Buffer.from(uploads[0].body).toString()).toBe(PDF.toString());
    expect(result).toEqual({ bytes: PDF.length });
  });

  it("removes its working directory afterwards, even on failure", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "convert-cleanup-"));
    const { d } = deps({
      workDir: async () => dir,
      runSoffice: async () => {
        throw new Error("soffice crashed");
      },
    });

    await expect(convertDocument(request, d)).rejects.toThrow("soffice crashed");
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("reports a failed download as an upstream error", async () => {
    const { d } = deps({ fetch: vi.fn(async () => new Response("gone", { status: 404 })) });
    await expect(convertDocument(request, d)).rejects.toMatchObject({
      status: 502,
      message: "Source download failed with status 404",
    });
  });

  it("reports a document LibreOffice cannot convert as unprocessable", async () => {
    const { d } = deps({ runSoffice: vi.fn(async () => {}) });
    const failure = convertDocument(request, d);
    await expect(failure).rejects.toBeInstanceOf(ConversionError);
    await expect(failure).rejects.toMatchObject({ status: 422, message: "LibreOffice produced no PDF" });
  });

  it("reports a rejected upload as an upstream error", async () => {
    const { d } = deps({
      fetch: vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
        init?.method === "PUT" ? new Response("denied", { status: 403 }) : new Response(Buffer.from("PK")),
      ),
    });
    await expect(convertDocument(request, d)).rejects.toMatchObject({
      status: 502,
      message: "PDF upload failed with status 403",
    });
  });
});
