// Download an Office document, convert it to PDF with headless LibreOffice,
// and upload the PDF. Side effects (network, process, temp dir) are injected
// so the flow is testable without LibreOffice installed.
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ConvertRequest } from "./request.ts";

export interface ConvertDeps {
  fetch: typeof fetch;
  // Converts `input` to `<outDir>/<input name>.pdf`.
  runSoffice(input: string, outDir: string): Promise<void>;
  // A fresh, empty working directory; removed after each conversion.
  workDir(): Promise<string>;
}

export interface ConvertResult {
  bytes: number;
}

// Carries the HTTP status the server should answer with.
export class ConversionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function convertDocument(request: ConvertRequest, deps: ConvertDeps): Promise<ConvertResult> {
  const download = await deps.fetch(request.sourceUrl);
  if (!download.ok) {
    throw new ConversionError(502, `Source download failed with status ${download.status}`);
  }

  const dir = await deps.workDir();
  try {
    const input = path.join(dir, `input.${request.format}`);
    await writeFile(input, new Uint8Array(await download.arrayBuffer()));
    await deps.runSoffice(input, dir);

    const pdf = await readFile(path.join(dir, "input.pdf")).catch(() => {
      throw new ConversionError(422, "LibreOffice produced no PDF");
    });

    const upload = await deps.fetch(request.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf", "x-upsert": "true" },
      body: new Uint8Array(pdf),
    });
    if (!upload.ok) {
      throw new ConversionError(502, `PDF upload failed with status ${upload.status}`);
    }
    return { bytes: pdf.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
