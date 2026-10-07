// Office → PDF step of process-material-job. A fresh DOCX/PPTX job is
// converted by the office converter (services/office-converter) and then
// requeued as an ordinary PDF job, so everything after this point (OCR by page
// range, embedding, page images, highlights) is the PDF pipeline unchanged.
// The original stays in storage; the PDF lives at converted/<material_id>.pdf.

export const CONVERTIBLE_OFFICE_FORMATS = ["docx", "pptx"] as const;
export type OfficeFormat = (typeof CONVERTIBLE_OFFICE_FORMATS)[number];

// LibreOffice is bounded at 100s inside the converter; this leaves room for
// the download and upload while staying inside the edge function's wall clock.
export const CONVERTER_CALL_TIMEOUT_MS = 120_000;

// Mirrors services/office-converter/src/request.ts.
export interface ConverterRequestBody {
  sourceUrl: string;
  uploadUrl: string;
  format: OfficeFormat;
}

export interface ConverterResponseBody {
  bytes: number;
  convertMs: number;
}

export interface OfficeConversionDeps {
  createDownloadUrl(path: string): Promise<string>;
  createUploadUrl(path: string): Promise<string>;
  callConverter(body: ConverterRequestBody): Promise<ConverterResponseBody>;
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
  const [sourceUrl, uploadUrl] = await Promise.all([
    deps.createDownloadUrl(sourcePath),
    deps.createUploadUrl(pdfPath),
  ]);
  await deps.callConverter({ sourceUrl, uploadUrl, format });
  return pdfPath;
}

export function createConverterClient(
  url: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): (body: ConverterRequestBody) => Promise<ConverterResponseBody> {
  return async (body) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONVERTER_CALL_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.json().then((b) => b?.error).catch(() => null);
      throw new Error(`Converter returned ${response.status}: ${detail ?? response.statusText}`);
    }
    return (await response.json()) as ConverterResponseBody;
  };
}
