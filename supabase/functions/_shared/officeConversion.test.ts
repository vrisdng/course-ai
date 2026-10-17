// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  CLOUDCONVERT_SYNC_JOBS_URL,
  convertOfficeDocument,
  convertedPdfPath,
  createCloudConvertClient,
  isConvertibleOffice,
  type OfficeConversionDeps,
} from "./officeConversion.ts";

const MATERIAL = "11111111-2222-3333-4444-555555555555";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

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
      convertToPdf: vi.fn(async () => PDF_BYTES),
      uploadPdf: vi.fn(async () => {}),
    } satisfies OfficeConversionDeps;
  }

  it("signs the original, converts it, uploads the PDF and returns its path", async () => {
    const d = deps();

    const pdfPath = await convertOfficeDocument(MATERIAL, "course/abc-notes.docx", "docx", d);

    expect(pdfPath).toBe(`converted/${MATERIAL}.pdf`);
    expect(d.createDownloadUrl).toHaveBeenCalledWith("course/abc-notes.docx");
    expect(d.convertToPdf).toHaveBeenCalledWith("https://storage.test/sign/course/abc-notes.docx?token=d", "docx");
    expect(d.uploadPdf).toHaveBeenCalledWith(`converted/${MATERIAL}.pdf`, PDF_BYTES);
  });

  it("propagates conversion failures without uploading", async () => {
    const d = deps();
    d.convertToPdf.mockRejectedValueOnce(new Error("CloudConvert job failed: convert: bad file"));

    await expect(convertOfficeDocument(MATERIAL, "c/x.pptx", "pptx", d)).rejects.toThrow("bad file");
    expect(d.uploadPdf).not.toHaveBeenCalled();
  });
});

describe("createCloudConvertClient", () => {
  const SOURCE = "https://ref.supabase.co/storage/v1/object/sign/course-materials/a.pptx?token=t";
  const EXPORT_URL = "https://storage.cloudconvert.com/tasks/xyz/a.pdf";

  function job(overrides: Record<string, unknown> = {}) {
    return {
      data: {
        id: "job-1",
        status: "finished",
        tasks: [
          { name: "import", operation: "import/url", status: "finished", message: null, code: null },
          { name: "convert", operation: "convert", status: "finished", message: null, code: null },
          {
            name: "export",
            operation: "export/url",
            status: "finished",
            message: null,
            code: null,
            result: { files: [{ filename: "a.pdf", url: EXPORT_URL }] },
          },
        ],
        ...overrides,
      },
    };
  }

  function fetchReturning(jobBody: unknown, jobStatus = 201, fileResponse = new Response(PDF_BYTES)) {
    return vi.fn(async (input: string | URL | Request, _init?: RequestInit) =>
      String(input) === EXPORT_URL ? fileResponse : new Response(JSON.stringify(jobBody), { status: jobStatus }),
    );
  }

  it("creates an import → convert → export job on the sync endpoint and returns the PDF bytes", async () => {
    const fetchImpl = fetchReturning(job());
    const convert = createCloudConvertClient("cc-key", fetchImpl);

    const pdf = await convert(SOURCE, "pptx");

    expect(pdf).toEqual(PDF_BYTES);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CLOUDCONVERT_SYNC_JOBS_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer cc-key", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      tasks: {
        import: { operation: "import/url", url: SOURCE },
        convert: { operation: "convert", input: "import", input_format: "pptx", output_format: "pdf" },
        export: { operation: "export/url", input: "convert" },
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(EXPORT_URL, expect.anything());
  });

  it("names the failing task when the job ends in error", async () => {
    const failed = job({
      status: "error",
      tasks: [
        { name: "import", operation: "import/url", status: "finished", message: null, code: null },
        { name: "convert", operation: "convert", status: "error", message: "Unsupported file", code: "INVALID_FILE" },
      ],
    });
    const convert = createCloudConvertClient("cc-key", fetchReturning(failed));

    await expect(convert(SOURCE, "docx")).rejects.toThrow("CloudConvert job failed: convert (INVALID_FILE): Unsupported file");
  });

  it("surfaces API errors such as a bad key or no credits", async () => {
    const fetchImpl = fetchReturning({ message: "Unauthenticated.", code: "UNAUTHENTICATED" }, 401);
    const convert = createCloudConvertClient("bad-key", fetchImpl);

    await expect(convert(SOURCE, "docx")).rejects.toThrow("CloudConvert returned 401: Unauthenticated.");
  });

  it("fails when the finished job has no exported file", async () => {
    const noFile = job();
    noFile.data.tasks[2].result = { files: [] };
    const convert = createCloudConvertClient("cc-key", fetchReturning(noFile));

    await expect(convert(SOURCE, "docx")).rejects.toThrow("CloudConvert job finished without an exported file");
  });

  it("fails when the PDF download fails", async () => {
    const convert = createCloudConvertClient("cc-key", fetchReturning(job(), 201, new Response("gone", { status: 404 })));

    await expect(convert(SOURCE, "docx")).rejects.toThrow("Could not download the converted PDF: 404");
  });
});
