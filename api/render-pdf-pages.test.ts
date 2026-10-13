// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./render-pdf-pages.js";
import { buildFixturePdf } from "./_lib/testPdf.js";

const ORIGIN = "https://project.supabase.co";
const SECRET = "test-render-secret";
const pdfUrl = `${ORIGIN}/storage/v1/object/sign/course-materials/deck.pdf?token=t`;
const uploadUrl = (n: number) =>
  `${ORIGIN}/storage/v1/object/upload/sign/course-materials/page-images/m/page-${n}.webp?token=t${n}`;

const fixture = buildFixturePdf([
  { width: 600, height: 800, texts: [{ text: "Page one heading", x: 60, y: 720, size: 24 }] },
  { width: 600, height: 800, texts: [{ text: "Page two heading", x: 60, y: 720, size: 24 }] },
]);

interface Upload {
  url: string;
  contentType: string | null;
  upsert: string | null;
  bytes: number;
}

let uploads: Upload[];
let failUploadFor: string | null;

function request(body: unknown, authorization: string | null = `Bearer ${SECRET}`): Request {
  return new Request("https://app.test/api/render-pdf-pages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("RENDER_SERVICE_SECRET", SECRET);
  vi.stubEnv("SUPABASE_URL", ORIGIN);
  uploads = [];
  failUploadFor = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === pdfUrl) {
        return new Response(fixture);
      }
      if (init?.method === "PUT") {
        const headers = new Headers(init.headers);
        uploads.push({
          url,
          contentType: headers.get("content-type"),
          upsert: headers.get("x-upsert"),
          bytes: (init.body as Uint8Array).byteLength,
        });
        return url === failUploadFor ? new Response("denied", { status: 403 }) : new Response("{}");
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/render-pdf-pages", () => {
  it("rejects callers without the shared secret", async () => {
    const response = await POST(request({ pdfUrl, pages: [] }, "Bearer nope"));
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies", async () => {
    expect((await POST(request("{not json"))).status).toBe(400);
    const foreign = await POST(request({ pdfUrl: "https://evil.test/x.pdf", pages: [{ pageNumber: 1, uploadUrl: uploadUrl(1) }] }));
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "pdfUrl must point at the storage origin" });
  });

  it("fails clearly when the server is not configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const response = await POST(request({ pdfUrl, pages: [{ pageNumber: 1, uploadUrl: uploadUrl(1) }] }));
    expect(response.status).toBe(500);
  });

  it("renders each page, uploads it to its signed URL and returns its lines", async () => {
    const response = await POST(
      request({
        pdfUrl,
        width: 600,
        pages: [
          { pageNumber: 1, uploadUrl: uploadUrl(1) },
          { pageNumber: 2, uploadUrl: uploadUrl(2) },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pageCount).toBe(2);
    expect(body.failed).toEqual([]);
    expect(body.pages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([1, 2]);
    expect(body.pages[0]).toMatchObject({ width: 600, height: 800 });
    expect(body.pages[1].lines[0].text).toBe("Page two heading");

    expect(uploads.map((u) => u.url)).toEqual([uploadUrl(1), uploadUrl(2)]);
    for (const upload of uploads) {
      expect(upload.contentType).toBe("image/webp");
      expect(upload.upsert).toBe("true");
      expect(upload.bytes).toBeGreaterThan(0);
    }
  });

  it("reports pages past the end and failed uploads without failing the batch", async () => {
    failUploadFor = uploadUrl(2);
    const response = await POST(
      request({
        pdfUrl,
        width: 400,
        pages: [
          { pageNumber: 1, uploadUrl: uploadUrl(1) },
          { pageNumber: 2, uploadUrl: uploadUrl(2) },
          { pageNumber: 9, uploadUrl: uploadUrl(9) },
        ],
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([1]);
    expect(body.failed).toEqual([
      { pageNumber: 2, error: "Upload failed with status 403" },
      { pageNumber: 9, error: "Page 9 is past the end of the document (2 pages)" },
    ]);
  });

  it("returns 502 when the PDF cannot be downloaded", async () => {
    const missing = `${ORIGIN}/storage/v1/object/sign/course-materials/missing.pdf?token=t`;
    const response = await POST(request({ pdfUrl: missing, pages: [{ pageNumber: 1, uploadUrl: uploadUrl(1) }] }));
    expect(response.status).toBe(502);
  });

  it("returns 422 when the file is not a readable PDF", async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => new Response("definitely not a pdf"));
    const response = await POST(request({ pdfUrl, pages: [{ pageNumber: 1, uploadUrl: uploadUrl(1) }] }));
    expect(response.status).toBe(422);
  });
});
