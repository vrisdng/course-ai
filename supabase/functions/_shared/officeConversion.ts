// Office → PDF step of process-material-job. A fresh DOCX/PPTX job is
// converted by CloudConvert and then requeued as an ordinary PDF job, so
// everything after this point (OCR by page range, embedding, page images,
// highlights) is the PDF pipeline unchanged. The original stays in storage;
// the PDF lives at converted/<material_id>.pdf.

export const CONVERTIBLE_OFFICE_FORMATS = ["docx", "pptx"] as const;
export type OfficeFormat = (typeof CONVERTIBLE_OFFICE_FORMATS)[number];

// Creates the job and blocks until it finishes or fails.
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

type CloudConvertStatus = "waiting" | "processing" | "finished" | "error";

interface CloudConvertTask {
  name: string;
  operation: string;
  status: CloudConvertStatus;
  message: string | null;
  code: string | null;
  result?: { files?: { filename: string; url: string }[] };
}

interface CloudConvertJob {
  id: string;
  status: CloudConvertStatus;
  tasks: CloudConvertTask[];
}

interface CloudConvertJobRequest {
  tasks: {
    import: { operation: "import/url"; url: string };
    convert: { operation: "convert"; input: "import"; input_format: OfficeFormat; output_format: "pdf" };
    export: { operation: "export/url"; input: "convert" };
  };
}

function jobRequest(sourceUrl: string, format: OfficeFormat): CloudConvertJobRequest {
  return {
    tasks: {
      import: { operation: "import/url", url: sourceUrl },
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

export function createCloudConvertClient(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): OfficeConversionDeps["convertToPdf"] {
  return async (sourceUrl, format) => {
    const signal = AbortSignal.timeout(CONVERSION_TIMEOUT_MS);
    const response = await fetchImpl(CLOUDCONVERT_SYNC_JOBS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(jobRequest(sourceUrl, format)),
      signal,
    });
    if (!response.ok) {
      const detail = await response.json().then((b) => b?.message).catch(() => null);
      throw new Error(`CloudConvert returned ${response.status}: ${detail ?? response.statusText}`);
    }

    const { data: job } = (await response.json()) as { data: CloudConvertJob };
    if (job.status !== "finished") throw jobFailure(job);

    const fileUrl = job.tasks.find((task) => task.name === "export")?.result?.files?.[0]?.url;
    if (!fileUrl) throw new Error("CloudConvert job finished without an exported file");

    const file = await fetchImpl(fileUrl, { signal });
    if (!file.ok) throw new Error(`Could not download the converted PDF: ${file.status}`);
    return new Uint8Array(await file.arrayBuffer());
  };
}
