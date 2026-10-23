// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { handleUploadVideo, type UploadVideoDeps } from "./handler.ts";

function deps(overrides: Partial<UploadVideoDeps> = {}): UploadVideoDeps {
  return {
    assemblyConfigured: true,
    authorize: vi.fn().mockResolvedValue("admin"),
    forwardToAssembly: vi.fn().mockResolvedValue({ uploadUrl: "https://cdn.assemblyai.com/upload/abc" }),
    ...overrides,
  };
}

function request(contentType: string | null, headers: Record<string, string> = { Authorization: "Bearer token" }): Request {
  return new Request("http://localhost/functions/v1/upload-video", {
    method: "POST",
    headers: { ...(contentType ? { "Content-Type": contentType } : {}), ...headers },
    body: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
  });
}

describe("handleUploadVideo (legacy AssemblyAI proxy)", () => {
  it("keeps its own auth checks", async () => {
    const d = deps();
    expect((await handleUploadVideo(request("video/mp4", {}), d)).status).toBe(401);
    (d.authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce("unauthorized");
    expect((await handleUploadVideo(request("video/mp4"), d)).status).toBe(401);
    (d.authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce("forbidden");
    expect((await handleUploadVideo(request("video/mp4"), d)).status).toBe(403);
    expect(d.forwardToAssembly).not.toHaveBeenCalled();
  });

  it("forwards MP4 and WebM bodies to AssemblyAI", async () => {
    for (const type of ["video/mp4", "video/webm"]) {
      const d = deps();
      const response = await handleUploadVideo(request(type), d);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ uploadUrl: "https://cdn.assemblyai.com/upload/abc" });
      expect(d.forwardToAssembly).toHaveBeenCalledWith(expect.anything(), type);
    }
  });

  it.each([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/png",
    "audio/mpeg",
    "application/octet-stream",
    null,
  ])("refuses to send %s bytes to the paid transcription provider", async (type) => {
    const d = deps();
    const response = await handleUploadVideo(request(type), d);
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: "Only PDF documents and MP4 or WebM videos are accepted.",
      code: "unsupported_type",
    });
    expect(d.forwardToAssembly).not.toHaveBeenCalled();
  });

  it("reports provider failures and missing configuration", async () => {
    expect((await handleUploadVideo(request("video/mp4"), deps({ assemblyConfigured: false }))).status).toBe(500);
    const failing = deps({ forwardToAssembly: vi.fn().mockResolvedValue({ error: "AssemblyAI upload failed: 500" }) });
    const response = await handleUploadVideo(request("video/mp4"), failing);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "AssemblyAI upload failed: 500" });
    const throwing = deps({ forwardToAssembly: vi.fn().mockRejectedValue(new Error("network down")) });
    expect((await handleUploadVideo(request("video/mp4"), throwing)).status).toBe(500);
  });
});
