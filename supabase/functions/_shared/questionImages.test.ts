import { describe, expect, it, vi } from "vitest";

import {
  MAX_QUESTION_IMAGE_BYTES,
  MAX_QUESTION_IMAGES,
  attachmentRows,
  contentTypeForImagePath,
  encodeQuestionImages,
  parseQuestionImagePaths,
} from "./questionImages.ts";

const USER = "6f1c2a8e-1111-4222-8333-944455556666";
const path = (n: number, ext = "png") => `${USER}/0b6c1d2e-0000-4000-8000-00000000000${n}.${ext}`;

describe("parseQuestionImagePaths", () => {
  it("accepts no images", () => {
    expect(parseQuestionImagePaths(undefined, USER)).toEqual({ ok: true, paths: [] });
    expect(parseQuestionImagePaths([], USER)).toEqual({ ok: true, paths: [] });
  });

  it("accepts the student's own uploads, deduplicated in order", () => {
    expect(parseQuestionImagePaths([path(1), path(2, "jpg"), path(1)], USER)).toEqual({ ok: true, paths: [path(1), path(2, "jpg")] });
  });

  it("rejects paths outside the student's folder or of the wrong shape", () => {
    for (const bad of [
      "someone-else/0b6c1d2e-0000-4000-8000-000000000001.png",
      `${USER}/../x.png`,
      `${USER}/notes.pdf`,
      `${USER}/0b6c1d2e-0000-4000-8000-000000000001.gif`,
      `${USER}/sub/0b6c1d2e-0000-4000-8000-000000000001.png`,
    ]) {
      expect(parseQuestionImagePaths([bad], USER)).toEqual({ ok: false, error: "One of the attached images is invalid." });
    }
    expect(parseQuestionImagePaths("x", USER)).toEqual({ ok: false, error: "Attached images must be a list." });
    expect(parseQuestionImagePaths([42], USER).ok).toBe(false);
  });

  it(`allows at most ${MAX_QUESTION_IMAGES} images`, () => {
    const many = Array.from({ length: MAX_QUESTION_IMAGES + 1 }, (_, i) => path(i));
    expect(parseQuestionImagePaths(many, USER)).toEqual({ ok: false, error: `Attach at most ${MAX_QUESTION_IMAGES} images.` });
  });
});

describe("contentTypeForImagePath", () => {
  it("maps the allowed extensions", () => {
    expect(contentTypeForImagePath("a/b.png")).toBe("image/png");
    expect(contentTypeForImagePath("a/b.jpg")).toBe("image/jpeg");
    expect(contentTypeForImagePath("a/b.JPEG")).toBe("image/jpeg");
    expect(contentTypeForImagePath("a/b.webp")).toBe("image/webp");
    expect(contentTypeForImagePath("a/b.gif")).toBeNull();
  });
});

describe("encodeQuestionImages", () => {
  it("downloads each image and base64-encodes it", async () => {
    const download = vi.fn(async () => new Uint8Array([104, 105]));
    await expect(encodeQuestionImages([path(1), path(2, "webp")], download)).resolves.toEqual([
      { path: path(1), base64Data: "aGk=", mimeType: "image/png", sizeBytes: 2 },
      { path: path(2, "webp"), base64Data: "aGk=", mimeType: "image/webp", sizeBytes: 2 },
    ]);
    expect(download).toHaveBeenCalledWith(path(1));
  });

  it("fails when an image is missing or too large", async () => {
    await expect(encodeQuestionImages([path(1)], async () => null)).rejects.toThrow("Couldn't read an attached image");
    const big = new Uint8Array(MAX_QUESTION_IMAGE_BYTES + 1);
    await expect(encodeQuestionImages([path(1)], async () => big)).rejects.toThrow("too large");
  });

  it("encodes large images without overflowing the call stack", async () => {
    const bytes = new Uint8Array(300_000).fill(65);
    const [image] = await encodeQuestionImages([path(1)], async () => bytes);
    expect(image.base64Data.length).toBe(400_000);
    expect(image.base64Data.startsWith("QUFB")).toBe(true);
  });
});

describe("attachmentRows", () => {
  it("links each image to the saved question, in order", () => {
    const images = [
      { path: path(1), base64Data: "", mimeType: "image/png", sizeBytes: 10 },
      { path: path(2, "jpg"), base64Data: "", mimeType: "image/jpeg", sizeBytes: 20 },
    ];
    expect(attachmentRows("msg-1", images)).toEqual([
      { message_id: "msg-1", storage_path: path(1), content_type: "image/png", size_bytes: 10, position: 0 },
      { message_id: "msg-1", storage_path: path(2, "jpg"), content_type: "image/jpeg", size_bytes: 20, position: 1 },
    ]);
  });
});
