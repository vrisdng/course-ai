// Office → PDF step of process-material-job. A fresh DOCX/PPTX job is
// converted by CloudConvert and then requeued as an ordinary PDF job, so
// everything after this point (OCR by page range, embedding, page images,
// highlights) is the PDF pipeline unchanged. The original stays in storage;
// the PDF lives at converted/<material_id>.pdf.

export const CONVERTIBLE_OFFICE_FORMATS = ["docx", "pptx"] as const;
export type OfficeFormat = (typeof CONVERTIBLE_OFFICE_FORMATS)[number];

export const CLOUDCONVERT_JOBS_URL = "https://api.cloudconvert.com/v2/jobs";
// Same API, but each call blocks until the job finishes or fails.
export const CLOUDCONVERT_SYNC_JOBS_URL = "https://sync.api.cloudconvert.com/v2/jobs";

// Covers the job and the PDF download together, inside the edge function's
// wall clock.
export const CONVERSION_TIMEOUT_MS = 120_000;

export interface OfficeConversionDeps {
  createDownloadUrl(path: string): Promise<string>;
  convertToPdf(sourceUrl: string, format: OfficeFormat): Promise<Uint8Array>;
  uploadPdf(path: string, pdf: Uint8Array): Promise<void>;
}

export function isConvertibleOffice(extension: string): extension is OfficeFormat {
  return (CONVERTIBLE_OFFICE_FORMATS as readonly string[]).includes(extension);
}

export function convertedPdfPath(materialId: string): string {
  return `converted/${materialId}.pdf`;
}

export async function convertOfficeDocument(
  materialId: string,
  sourcePath: string,
  format: OfficeFormat,
  deps: OfficeConversionDeps,
): Promise<string> {
  const pdfPath = convertedPdfPath(materialId);
  const sourceUrl = await deps.createDownloadUrl(sourcePath);
  const pdf = await deps.convertToPdf(sourceUrl, format);
  await deps.uploadPdf(pdfPath, pdf);
  return pdfPath;
}

// ---------------------------------------------------------------------------
// CloudConvert API v2 (https://cloudconvert.com/api/v2)
// ---------------------------------------------------------------------------

// "url": CloudConvert fetches the original from its signed storage URL.
// "upload": we fetch it and upload it to CloudConvert, for a local stack whose
// storage CloudConvert cannot reach.
export type CloudConvertImportMode = "url" | "upload";

const LOCAL_SUPABASE_HOSTS = new Set(["kong", "localhost", "127.0.0.1", "host.docker.internal"]);

export function cloudConvertImportMode(supabaseUrl: string): CloudConvertImportMode {
  return LOCAL_SUPABASE_HOSTS.has(new URL(supabaseUrl).hostname) ? "upload" : "url";
}

type CloudConvertStatus = "waiting" | "processing" | "finished" | "error";

interface CloudConvertTask {
  name: string;
  operation: string;
  status: CloudConvertStatus;
  message: string | null;
  code: string | null;
  result?: {
    files?: { filename: string; url: string }[];
    form?: { url: string; parameters: Record<string, string> };
  };
}

interface CloudConvertJob {
  id: string;
  status: CloudConvertStatus;
  tasks: CloudConvertTask[];
}

type ImportTask = { operation: "import/url"; url: string } | { operation: "import/upload" };

interface CloudConvertJobRequest {
  tasks: {
    import: ImportTask;
    convert: { operation: "convert"; input: "import"; input_format: OfficeFormat; output_format: "pdf" };
    export: { operation: "export/url"; input: "convert" };
  };
}

function jobRequest(importTask: ImportTask, format: OfficeFormat): CloudConvertJobRequest {
  return {
    tasks: {
      import: importTask,
      convert: { operation: "convert", input: "import", input_format: format, output_format: "pdf" },
      export: { operation: "export/url", input: "convert" },
    },
  };
}

function jobFailure(job: CloudConvertJob): Error {
  const failed = job.tasks.find((task) => task.status === "error");
  if (!failed) return new Error(`CloudConvert job ${job.id} ended with status ${job.status}`);
  const code = failed.code ? ` (${failed.code})` : "";
  return new Error(`CloudConvert job failed: ${failed.name}${code}: ${failed.message ?? "no message"}`);
}

function findTask(job: CloudConvertJob, name: string): CloudConvertTask | undefined {
  return job.tasks.find((task) => task.name === name);
}

export function createCloudConvertClient(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  mode: CloudConvertImportMode = "url",
): OfficeConversionDeps["convertToPdf"] {
  async function callApi(url: string, signal: AbortSignal, body?: CloudConvertJobRequest): Promise<CloudConvertJob> {
    const response = await fetchImpl(url, {
      method: body ? "POST" : "GET",
      headers: body
        ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
        : { Authorization: `Bearer ${apiKey}` },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!response.ok) {
      const detail = await response.json().then((b) => b?.message).catch(() => null);
      throw new Error(`CloudConvert returned ${response.status}: ${detail ?? response.statusText}`);
    }
    return ((await response.json()) as { data: CloudConvertJob }).data;
  }

  async function runUrlJob(sourceUrl: string, format: OfficeFormat, signal: AbortSignal): Promise<CloudConvertJob> {
    return await callApi(CLOUDCONVERT_SYNC_JOBS_URL, signal, jobRequest({ operation: "import/url", url: sourceUrl }, format));
  }

  async function runUploadJob(sourceUrl: string, format: OfficeFormat, signal: AbortSignal): Promise<CloudConvertJob> {
    const created = await callApi(CLOUDCONVERT_JOBS_URL, signal, jobRequest({ operation: "import/upload" }, format));
    const form = findTask(created, "import")?.result?.form;
    if (!form) throw new Error("CloudConvert job has no upload form");

    const original = await fetchImpl(sourceUrl, { signal });
    if (!original.ok) throw new Error(`Could not download the original: ${original.status}`);

    // CloudConvert requires the file to be the last form field.
    const body = new FormData();
    for (const [key, value] of Object.entries(form.parameters)) body.append(key, value);
    body.append("file", await original.blob(), `source.${format}`);
    const upload = await fetchImpl(form.url, { method: "POST", body, signal });
    if (!upload.ok) throw new Error(`CloudConvert upload failed: ${upload.status}`);

    return await callApi(`${CLOUDCONVERT_SYNC_JOBS_URL}/${created.id}`, signal);
  }

  return async (sourceUrl, format) => {
    const signal = AbortSignal.timeout(CONVERSION_TIMEOUT_MS);
    const job = mode === "upload"
      ? await runUploadJob(sourceUrl, format, signal)
      : await runUrlJob(sourceUrl, format, signal);
    if (job.status !== "finished") throw jobFailure(job);

    const fileUrl = findTask(job, "export")?.result?.files?.[0]?.url;
    if (!fileUrl) throw new Error("CloudConvert job finished without an exported file");

    const file = await fetchImpl(fileUrl, { signal });
    if (!file.ok) throw new Error(`Could not download the converted PDF: ${file.status}`);
    return new Uint8Array(await file.arrayBuffer());
  };
}
