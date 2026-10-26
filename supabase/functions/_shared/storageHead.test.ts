// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { readStoredObjectHead, STORED_HEAD_BYTES } from "./storageHead.ts";

const options = {
  supabaseUrl: "http://kong:8000",
  serviceKey: "service-key",
  bucket: "course-materials",
  path: "course-1/uuid-Week 1 & notes.pdf",
};

function bodyOf(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index % 256);
}

describe("readStoredObjectHead", () => {
  it("asks Storage for only the first bytes, with service credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(bodyOf(STORED_HEAD_BYTES), { status: 206, headers: { "Content-Type": "application/pdf" } }),
    );
    const result = await readStoredObjectHead({ ...options, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://kong:8000/storage/v1/object/course-materials/course-1/uuid-Week%201%20%26%20notes.pdf",
      {
        headers: {
          Authorization: "Bearer service-key",
          apikey: "service-key",
          Range: `bytes=0-${STORED_HEAD_BYTES - 1}`,
        },
      },
    );
    expect(result).toEqual({ contentType: "application/pdf", head: bodyOf(STORED_HEAD_BYTES) });
  });

  it("truncates a full-body reply when Range is ignored", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(bodyOf(10_000), { status: 200 }));
    const result = await readStoredObjectHead({ ...options, fetchImpl });
    expect(result?.head).toEqual(bodyOf(STORED_HEAD_BYTES));
    expect(result?.contentType).toBeNull();
  });

  it("returns the whole file when it is shorter than the head", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(bodyOf(5), { status: 200 }));
    expect((await readStoredObjectHead({ ...options, fetchImpl }))?.head).toEqual(bodyOf(5));
  });

  it("returns null when the object does not exist", async () => {
    for (const status of [400, 404]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status }));
      expect(await readStoredObjectHead({ ...options, fetchImpl })).toBeNull();
    }
  });

  it("throws on other Storage failures so the caller does not guess", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 503 }));
    await expect(readStoredObjectHead({ ...options, fetchImpl })).rejects.toThrow("503");
  });
});
