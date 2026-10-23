// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  UPLOAD_POLICY,
  UPLOAD_REJECTED_STATUS,
  acceptedUploadSummary,
  checkUpload,
  checkUploadContents,
  fileInputAccept,
  type UploadPolicy,
} from "./uploadPolicy.ts";

const OFFICE_ENABLED: UploadPolicy = { enabledFamilies: ["pdf", "video", "office"] };
const bytes = (text: string) => new TextEncoder().encode(text);
const PDF_HEAD = bytes("%PDF-1.7\n%âã\n1 0 obj");
const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("UPLOAD_POLICY", () => {
  it("accepts only PDF documents and videos", () => {
    expect(UPLOAD_POLICY.enabledFamilies).toEqual(["pdf", "video"]);
    expect(UPLOAD_REJECTED_STATUS).toBe(415);
  });
});

describe("checkUpload", () => {
  it("admits PDFs and routes them to the document pipeline", () => {
    expect(checkUpload({ fileName: "Week 1.PDF", contentType: "application/pdf" })).toEqual({
      allowed: true,
      family: "pdf",
      extension: "pdf",
      pipeline: "document",
      contentType: "application/pdf",
    });
  });

  it("admits PDFs whose browser type is missing or generic", () => {
    for (const contentType of [undefined, null, "", "application/octet-stream", "binary/octet-stream"]) {
      expect(checkUpload({ fileName: "notes.pdf", contentType })).toMatchObject({ allowed: true, family: "pdf" });
    }
  });

  it("admits MP4 and WebM videos only with a matching declared type", () => {
    expect(checkUpload({ fileName: "lecture.mp4", contentType: "video/mp4" })).toMatchObject({
      allowed: true, family: "video", extension: "mp4", pipeline: "video", contentType: "video/mp4",
    });
    expect(checkUpload({ fileName: "lecture.webm", contentType: "video/webm; codecs=vp9" })).toMatchObject({
      allowed: true, extension: "webm", contentType: "video/webm",
    });
    expect(checkUpload({ fileName: "lecture.mp4", contentType: "application/octet-stream" })).toMatchObject({
      allowed: false, reason: "type_mismatch",
    });
  });

  it("judges a video by its extension when the browser reports no type", () => {
    // The upload pipeline then declares the canonical type for it.
    for (const contentType of [undefined, null, ""]) {
      expect(checkUpload({ fileName: "lecture.webm", contentType })).toMatchObject({
        allowed: true, family: "video", contentType: "video/webm",
      });
    }
  });

  it.each([
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["legacy.doc", "application/msword"],
    ["diagram.png", "image/png"],
    ["photo.jpeg", "image/jpeg"],
    ["notes.txt", "text/plain"],
    ["code.ts", ""],
    ["slides.ppt", "application/vnd.ms-powerpoint"],
    ["sheet.xlsx", ""],
    ["clip.mov", "video/quicktime"],
    ["virus.exe", "application/x-msdownload"],
    ["README", "text/plain"],
    ["prototype.constructor", ""],
    ["prototype.__proto__", ""],
    ["trailing.", ""],
  ])("rejects %s as an unsupported type with a teacher-facing message", (fileName, contentType) => {
    const decision = checkUpload({ fileName, contentType });
    expect(decision).toMatchObject({ allowed: false, reason: "unsupported_type" });
    if (!decision.allowed) {
      expect(decision.message).toBe(
        `"${fileName}" can't be uploaded. Only PDF documents and MP4 or WebM videos are accepted.`,
      );
    }
  });

  it("rejects a supported extension whose declared type belongs to another format", () => {
    const decision = checkUpload({
      fileName: "renamed.pdf",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(decision).toMatchObject({ allowed: false, reason: "type_mismatch" });
    if (!decision.allowed) {
      expect(decision.message).toContain("doesn't match the .pdf extension");
      expect(decision.message).toContain("Only PDF documents and MP4 or WebM videos are accepted.");
    }
    expect(checkUpload({ fileName: "lecture.webm", contentType: "video/mp4" })).toMatchObject({
      allowed: false, reason: "type_mismatch",
    });
    expect(checkUpload({ fileName: "notes.pdf", contentType: "text/plain" })).toMatchObject({
      allowed: false, reason: "type_mismatch",
    });
  });

  it("rejects a stored path whose extension differs from the file name", () => {
    expect(checkUpload({ fileName: "notes.pdf", storagePath: "course/uuid-notes.docx" })).toMatchObject({
      allowed: false, reason: "type_mismatch",
    });
    expect(checkUpload({ fileName: "notes.pdf", storagePath: "course/uuid-notes.pdf" })).toMatchObject({
      allowed: true,
    });
  });

  it("re-enables Word and PowerPoint when the office family is switched back on", () => {
    expect(checkUpload({ fileName: "deck.pptx", contentType: "" }, OFFICE_ENABLED)).toEqual({
      allowed: true,
      family: "office",
      extension: "pptx",
      pipeline: "document",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    // Some systems report the ZIP container type for Office files.
    expect(checkUpload({ fileName: "notes.docx", contentType: "application/zip" }, OFFICE_ENABLED)).toMatchObject({
      allowed: true, family: "office",
    });
    expect(checkUpload({ fileName: "notes.docx", contentType: "application/pdf" }, OFFICE_ENABLED)).toMatchObject({
      allowed: false, reason: "type_mismatch",
    });
    const rejected = checkUpload({ fileName: "photo.png", contentType: "image/png" }, OFFICE_ENABLED);
    expect(rejected).toMatchObject({ allowed: false, reason: "unsupported_type" });
    if (!rejected.allowed) {
      expect(rejected.message).toContain("Only PDF documents, Word or PowerPoint files (DOCX, PPTX) and MP4 or WebM videos are accepted.");
    }
  });
});

describe("checkUploadContents", () => {
  const pdf = checkUpload({ fileName: "notes.pdf" });
  if (!pdf.allowed) throw new Error("fixture");

  it("accepts a PDF whose first bytes carry the %PDF- header", () => {
    expect(checkUploadContents("notes.pdf", pdf, PDF_HEAD)).toEqual(pdf);
    const leadingJunk = new Uint8Array([...new Uint8Array(200).fill(0x20), ...PDF_HEAD]);
    expect(checkUploadContents("notes.pdf", pdf, leadingJunk)).toEqual(pdf);
  });

  it("rejects a PDF name whose bytes are something else", () => {
    for (const head of [ZIP_HEAD, PNG_HEAD, bytes("hello world"), new Uint8Array()]) {
      const decision = checkUploadContents("notes.pdf", pdf, head);
      expect(decision).toMatchObject({ allowed: false, reason: "content_mismatch" });
      if (!decision.allowed) {
        expect(decision.message).toBe(
          `"notes.pdf" can't be uploaded: its contents aren't a valid PDF file. Only PDF documents and MP4 or WebM videos are accepted.`,
        );
      }
    }
    const late = new Uint8Array([...new Uint8Array(1100), ...PDF_HEAD]);
    expect(checkUploadContents("notes.pdf", pdf, late)).toMatchObject({ allowed: false });
  });

  it("checks Office files for the ZIP container they are stored in", () => {
    const docx = checkUpload({ fileName: "notes.docx" }, OFFICE_ENABLED);
    if (!docx.allowed) throw new Error("fixture");
    expect(checkUploadContents("notes.docx", docx, ZIP_HEAD, OFFICE_ENABLED)).toEqual(docx);
    expect(checkUploadContents("notes.docx", docx, PDF_HEAD, OFFICE_ENABLED)).toMatchObject({
      allowed: false, reason: "content_mismatch",
    });
  });
});

describe("policy-derived UI text", () => {
  it("summarises what teachers can upload", () => {
    expect(acceptedUploadSummary()).toBe("PDF documents and MP4 or WebM videos");
    expect(acceptedUploadSummary(OFFICE_ENABLED)).toBe(
      "PDF documents, Word or PowerPoint files (DOCX, PPTX) and MP4 or WebM videos",
    );
  });

  it("restricts the file chooser to the enabled formats", () => {
    expect(fileInputAccept()).toBe(".pdf,application/pdf,.mp4,video/mp4,.webm,video/webm");
    expect(fileInputAccept(OFFICE_ENABLED)).toContain(".docx");
    expect(fileInputAccept(OFFICE_ENABLED)).toContain(".pptx");
  });
});
