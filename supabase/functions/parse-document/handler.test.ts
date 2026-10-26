// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UploadPolicy } from "../_shared/uploadPolicy.ts";
import { handleParseDocument, type ParseDocumentDeps, type ParseDocumentMaterial } from "./handler.ts";

const MATERIAL_ID = "11111111-2222-4333-8444-555555555555";
const PDF_HEAD = new TextEncoder().encode("%PDF-1.7\n");
const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const OFFICE_ENABLED: UploadPolicy = { enabledFamilies: ["pdf", "video", "office"] };

function material(overrides: Partial<ParseDocumentMaterial> = {}): ParseDocumentMaterial {
  return {
    id: MATERIAL_ID,
    fileName: "Week 1.pdf",
    filePath: "course-1/uuid-Week 1.pdf",
    processingStatus: "processing",
    hasProcessingJob: false,
    ...overrides,
  };
}

function deps(overrides: Partial<ParseDocumentDeps> = {}): ParseDocumentDeps {
  return {
    authorize: vi.fn().mockResolvedValue("admin"),
    findMaterial: vi.fn().mockResolvedValue(material()),
    readObjectHead: vi.fn().mockResolvedValue({ contentType: "application/pdf", head: PDF_HEAD }),
    rejectMaterial: vi.fn().mockResolvedValue(undefined),
    markQueued: vi.fn().mockResolvedValue(undefined),
    enqueueJob: vi.fn().mockResolvedValue(undefined),
    triggerWorker: vi.fn(),
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = { Authorization: "Bearer token" }): Request {
  return new Request("http://localhost/functions/v1/parse-document", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const parseBody = (filePath = "course-1/uuid-Week 1.pdf", fileType = "pdf") => ({
  materialId: MATERIAL_ID, filePath, fileType,
});

describe("handleParseDocument", () => {
  let d: ParseDocumentDeps;
  beforeEach(() => {
    d = deps();
  });

  it("keeps its own auth: no header, bad token and non-admins are refused before anything else", async () => {
    expect((await handleParseDocument(request(parseBody(), {}), d)).status).toBe(401);
    (d.authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce("unauthorized");
    expect((await handleParseDocument(request(parseBody()), d)).status).toBe(401);
    (d.authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce("forbidden");
    expect((await handleParseDocument(request(parseBody()), d)).status).toBe(403);
    expect(d.findMaterial).not.toHaveBeenCalled();
    expect(d.enqueueJob).not.toHaveBeenCalled();
  });

  it("queues a PDF after checking its stored bytes", async () => {
    const response = await handleParseDocument(request(parseBody()), d);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ queued: true, materialId: MATERIAL_ID });
    expect(d.readObjectHead).toHaveBeenCalledWith("course-materials", "course-1/uuid-Week 1.pdf");
    expect(d.markQueued).toHaveBeenCalledWith(MATERIAL_ID);
    expect(d.enqueueJob).toHaveBeenCalledWith(MATERIAL_ID, {
      filePath: "course-1/uuid-Week 1.pdf", fileType: "pdf", bucketName: "course-materials",
    });
    expect(d.triggerWorker).toHaveBeenCalledWith(MATERIAL_ID);
    expect(d.rejectMaterial).not.toHaveBeenCalled();
  });

  it("queues a PDF stored as application/octet-stream when the bytes are a PDF", async () => {
    d = deps({ readObjectHead: vi.fn().mockResolvedValue({ contentType: "application/octet-stream", head: PDF_HEAD }) });
    expect((await handleParseDocument(request(parseBody()), d)).status).toBe(202);
    expect(d.enqueueJob).toHaveBeenCalled();
  });

  it.each([
    ["slides.pptx", "course-1/uuid-slides.pptx", "pptx"],
    ["notes.docx", "course-1/uuid-notes.docx", "docx"],
    ["diagram.png", "course-1/uuid-diagram.png", "png"],
    ["legacy.doc", "course-1/uuid-legacy.doc", "doc"],
    ["notes.txt", "course-1/uuid-notes.txt", "txt"],
  ])("rejects a new %s upload before storage access, job creation or conversion", async (fileName, filePath, fileType) => {
    d = deps({ findMaterial: vi.fn().mockResolvedValue(material({ fileName, filePath })) });
    const response = await handleParseDocument(request(parseBody(filePath, fileType)), d);
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body).toEqual({
      error: `"${fileName}" can't be uploaded. Only PDF documents and MP4 or WebM videos are accepted.`,
      code: "unsupported_type",
    });
    expect(d.readObjectHead).not.toHaveBeenCalled();
    expect(d.markQueued).not.toHaveBeenCalled();
    expect(d.enqueueJob).not.toHaveBeenCalled();
    expect(d.triggerWorker).not.toHaveBeenCalled();
    // The teacher sees the reason on the material row too.
    expect(d.rejectMaterial).toHaveBeenCalledWith(MATERIAL_ID, body.error);
  });

  it("judges the stored material, not the client's fileType claim", async () => {
    d = deps({ findMaterial: vi.fn().mockResolvedValue(material({ fileName: "deck.pptx", filePath: "course-1/uuid-deck.pptx" })) });
    expect((await handleParseDocument(request(parseBody("course-1/uuid-deck.pptx", "pdf")), d)).status).toBe(415);
    expect(d.enqueueJob).not.toHaveBeenCalled();
  });

  it("refuses a filePath that is not the material's own file", async () => {
    const response = await handleParseDocument(request(parseBody("course-1/other.pdf")), d);
    expect(response.status).toBe(400);
    expect(d.readObjectHead).not.toHaveBeenCalled();
    expect(d.enqueueJob).not.toHaveBeenCalled();
    expect(d.rejectMaterial).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown material and 400 for a missing id or path", async () => {
    d = deps({ findMaterial: vi.fn().mockResolvedValue(null) });
    expect((await handleParseDocument(request(parseBody()), d)).status).toBe(404);
    expect((await handleParseDocument(request({ materialId: MATERIAL_ID }), d)).status).toBe(400);
    expect(d.enqueueJob).not.toHaveBeenCalled();
  });

  it("rejects a renamed file whose stored bytes are not a PDF", async () => {
    d = deps({ readObjectHead: vi.fn().mockResolvedValue({ contentType: "application/pdf", head: ZIP_HEAD }) });
    const response = await handleParseDocument(request(parseBody()), d);
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: "content_mismatch" });
    expect(d.enqueueJob).not.toHaveBeenCalled();
    expect(d.rejectMaterial).toHaveBeenCalled();
  });

  it("rejects a PDF name whose stored type is another format", async () => {
    d = deps({
      readObjectHead: vi.fn().mockResolvedValue({
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", head: PDF_HEAD,
      }),
    });
    const response = await handleParseDocument(request(parseBody()), d);
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: "type_mismatch" });
    expect(d.enqueueJob).not.toHaveBeenCalled();
  });

  it("does not queue when the uploaded file is missing from storage", async () => {
    d = deps({ readObjectHead: vi.fn().mockResolvedValue(null) });
    expect((await handleParseDocument(request(parseBody()), d)).status).toBe(409);
    expect(d.enqueueJob).not.toHaveBeenCalled();
    expect(d.rejectMaterial).not.toHaveBeenCalled();
  });

  it("leaves existing Office materials untouched when they are sent back through admission", async () => {
    for (const existing of [
      material({ fileName: "old.docx", filePath: "course-1/uuid-old.docx", processingStatus: "completed" }),
      material({ fileName: "old.pptx", filePath: "course-1/uuid-old.pptx", processingStatus: "processing", hasProcessingJob: true }),
    ]) {
      d = deps({ findMaterial: vi.fn().mockResolvedValue(existing) });
      const response = await handleParseDocument(request(parseBody(existing.filePath, "docx")), d);
      expect(response.status).toBe(415);
      expect(d.rejectMaterial).not.toHaveBeenCalled();
      expect(d.markQueued).not.toHaveBeenCalled();
      expect(d.enqueueJob).not.toHaveBeenCalled();
    }
  });

  it("re-admits DOCX/PPTX into the retained conversion pipeline when the policy enables Office", async () => {
    d = deps({
      findMaterial: vi.fn().mockResolvedValue(material({ fileName: "deck.pptx", filePath: "course-1/uuid-deck.pptx" })),
      readObjectHead: vi.fn().mockResolvedValue({
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", head: ZIP_HEAD,
      }),
      policy: OFFICE_ENABLED,
    });
    const response = await handleParseDocument(request(parseBody("course-1/uuid-deck.pptx", "pptx")), d);
    expect(response.status).toBe(202);
    // fileType "pptx" is what process-material-job's isConvertibleOffice() branch picks up.
    expect(d.enqueueJob).toHaveBeenCalledWith(MATERIAL_ID, {
      filePath: "course-1/uuid-deck.pptx", fileType: "pptx", bucketName: "course-materials",
    });
  });

  it("answers CORS preflight", async () => {
    const response = await handleParseDocument(new Request("http://localhost", { method: "OPTIONS" }), d);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
