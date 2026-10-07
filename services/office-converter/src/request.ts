// Request contract and caller check for the Office → PDF converter. Only the
// process-material-job edge function calls it: it proves itself with
// CONVERTER_SECRET and hands over a signed download URL for the original and a
// signed upload URL for the PDF, so this service never holds Supabase
// credentials. Mirrors api/_lib/renderRequest.ts (separate deploy unit).
import { timingSafeEqual } from "node:crypto";

export const OFFICE_FORMATS = ["docx", "pptx"] as const;
export type OfficeFormat = (typeof OFFICE_FORMATS)[number];

export interface ConvertRequest {
  sourceUrl: string;
  uploadUrl: string;
  format: OfficeFormat;
}

export type ParseResult = { ok: true; request: ConvertRequest } | { ok: false; error: string };

export function isAuthorized(authorizationHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  const given = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function isUrlAtOrigin(value: unknown, origin: string): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function parseConvertRequest(body: unknown, storageOrigin: string): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const { sourceUrl, uploadUrl, format } = body as Record<string, unknown>;
  if (!OFFICE_FORMATS.includes(format as OfficeFormat)) {
    return { ok: false, error: "format must be docx or pptx" };
  }
  if (!isUrlAtOrigin(sourceUrl, storageOrigin)) {
    return { ok: false, error: "sourceUrl must point at the storage origin" };
  }
  if (!isUrlAtOrigin(uploadUrl, storageOrigin)) {
    return { ok: false, error: "uploadUrl must point at the storage origin" };
  }
  return { ok: true, request: { sourceUrl, uploadUrl, format: format as OfficeFormat } };
}
