// POST /convert: DOCX/PPTX → PDF for process-material-job. Runs as a Vercel
// container (Dockerfile.vercel); Node runs this TypeScript directly.
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { ConversionError, convertDocument, type ConvertDeps } from "./convert.ts";
import { isAuthorized, parseConvertRequest } from "./request.ts";

const SECRET = process.env.CONVERTER_SECRET;
const STORAGE_ORIGIN = process.env.SUPABASE_URL;
// One LibreOffice profile per instance; LibreOffice cannot share a profile
// between concurrent processes, so conversions on an instance are serialized.
const PROFILE = `file://${path.join(os.tmpdir(), "lo-profile")}`;
// Below the edge function's 120s call timeout (_shared/officeConversion.ts).
const SOFFICE_TIMEOUT_MS = 100_000;

function runSoffice(input: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "soffice",
      [`-env:UserInstallation=${PROFILE}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", outDir, input],
      { stdio: ["ignore", "ignore", "pipe"], timeout: SOFFICE_TIMEOUT_MS },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new ConversionError(422, `LibreOffice exited with ${code}: ${stderr.slice(0, 300)}`)),
    );
  });
}

const deps: ConvertDeps = {
  fetch,
  runSoffice,
  workDir: () => mkdtemp(path.join(os.tmpdir(), "convert-")),
};

let queue: Promise<unknown> = Promise.resolve();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

http
  .createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method !== "POST" || req.url !== "/convert") {
      return json(res, 404, { error: "Not found" });
    }
    if (!isAuthorized(req.headers.authorization, SECRET)) {
      return json(res, 401, { error: "Unauthorized" });
    }
    if (!STORAGE_ORIGIN) {
      return json(res, 500, { error: "SUPABASE_URL is not configured" });
    }

    const parsed = parseConvertRequest(await readJson(req), STORAGE_ORIGIN);
    if (!parsed.ok) {
      return json(res, 400, { error: parsed.error });
    }

    const started = Date.now();
    const job = queue.then(() => convertDocument(parsed.request, deps));
    queue = job.catch(() => {});
    try {
      const result = await job;
      json(res, 200, { ...result, convertMs: Date.now() - started });
    } catch (error) {
      const status = error instanceof ConversionError ? error.status : 500;
      json(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  })
  .listen(Number(process.env.PORT || 80), () => console.log("office-converter listening"));
