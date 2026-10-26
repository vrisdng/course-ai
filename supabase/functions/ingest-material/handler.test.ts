// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { UploadPolicy } from "../_shared/uploadPolicy.ts";
import { handleIngestMaterial, type IngestMaterialDeps, type IngestMaterialRecord } from "./handler.ts";

const MATERIAL_ID = "11111111-2222-4333-8444-555555555555";
const TEXT_ENABLED: UploadPolicy = { enabledFamilies: ["pdf", "video", "text"] };

function record(overrides: Partial<IngestMaterialRecord> = {}): IngestMaterialRecord {
  return {
    id: MATERIAL_ID,
    fileName: "lesson.md",
    filePath: "course-1/uuid-lesson.md",
    processingStatus: "processing",
    ...overrides,
  };
}

function deps(overrides: Partial<IngestMaterialDeps> = {}): IngestMaterialDeps {
  return {
    embeddingConfigured: true,
    authorize: vi.fn().mockResolvedValue("admin"),
    findMaterial: vi.fn().mockResolvedValue(record()),
    rejectMaterial: vi.fn().mockResolvedValue(undefined),
    ingest: vi.fn().mockResolvedValue(3),
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = { Authorization: "Bearer token" }): Request {
  return new Request("http://localhost/functions/v1/ingest-material", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("handleIngestMaterial", () => {
  it("keeps its own auth checks", async () => {
    const d = deps();
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "x" }, {}), d)).status).toBe(401);
    (d.authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce("unauthorized");
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "x" }), d)).status).toBe(401);
    (d.authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce("forbidden");
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "x" }), d)).status).toBe(403);
    (d.authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce("error");
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "x" }), d)).status).toBe(500);
    expect(d.ingest).not.toHaveBeenCalled();
  });

  it("rejects new text uploads before chunking or paid embedding", async () => {
    const d = deps();
    const response = await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "# Notes" }), d);
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body).toEqual({
      error: `"lesson.md" can't be uploaded. Only PDF documents and MP4 or WebM videos are accepted.`,
      code: "unsupported_type",
    });
    expect(d.ingest).not.toHaveBeenCalled();
    expect(d.rejectMaterial).toHaveBeenCalledWith(MATERIAL_ID, body.error);
  });

  it("does not mark an already indexed material failed", async () => {
    const d = deps({ findMaterial: vi.fn().mockResolvedValue(record({ processingStatus: "completed" })) });
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "# Notes" }), d)).status).toBe(415);
    expect(d.rejectMaterial).not.toHaveBeenCalled();
  });

  it("refuses to embed inline text for a PDF or video material", async () => {
    const d = deps({
      policy: TEXT_ENABLED,
      findMaterial: vi.fn().mockResolvedValue(record({ fileName: "notes.pdf", filePath: "course-1/uuid-notes.pdf" })),
    });
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "spoofed" }), d)).status).toBe(400);
    expect(d.ingest).not.toHaveBeenCalled();
    expect(d.rejectMaterial).not.toHaveBeenCalled();
  });

  it("validates the request body and the material", async () => {
    const d = deps({ findMaterial: vi.fn().mockResolvedValue(null) });
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID }), d)).status).toBe(400);
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "x" }), d)).status).toBe(404);
    const huge = deps({ policy: TEXT_ENABLED });
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "a".repeat(500_001) }), huge)).status).toBe(413);
    expect(huge.ingest).not.toHaveBeenCalled();
  });

  it("reports missing embedding configuration", async () => {
    const d = deps({ embeddingConfigured: false });
    expect((await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "x" }), d)).status).toBe(500);
  });

  it("still ingests text through the retained pipeline when the policy enables text", async () => {
    const d = deps({ policy: TEXT_ENABLED });
    const response = await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "# Notes" }), d);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inserted: 3 });
    expect(d.ingest).toHaveBeenCalledWith(MATERIAL_ID, "# Notes");
  });

  it("returns ingestion failures as 500s", async () => {
    const d = deps({ policy: TEXT_ENABLED, ingest: vi.fn().mockRejectedValue(new Error("No text content to process")) });
    const response = await handleIngestMaterial(request({ materialId: MATERIAL_ID, text: "  " }), d);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "No text content to process" });
  });
});
