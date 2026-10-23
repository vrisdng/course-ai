// Which new course materials may be uploaded. Every admission point checks
// this one policy: the admin upload hook (src/features/materials), plus
// parse-document, ingest-material, video-upload-session and upload-video on
// the server. It only gates NEW uploads. Materials already stored, and jobs
// already queued, keep their processing pipelines.
//
// To accept another family again, add it to UPLOAD_POLICY.enabledFamilies.
// The processing code for every family below is still in place; for example
// "office" sends DOCX/PPTX through the CloudConvert → PDF step in
// process-material-job (_shared/officeConversion.ts).
//
// The admin dashboard imports this file too, so keep it free of Deno and URL
// imports.

export type UploadFamily = "pdf" | "video" | "office" | "legacy-word" | "image" | "text";

// Which ingestion path an admitted file takes: parse-document (document),
// video-upload-session (video) or ingest-material (text).
export type UploadPipeline = "document" | "video" | "text";

export interface UploadPolicy {
  enabledFamilies: readonly UploadFamily[];
}

export const UPLOAD_POLICY: UploadPolicy = { enabledFamilies: ["pdf", "video"] };

// HTTP status for a refused admission.
export const UPLOAD_REJECTED_STATUS = 415;

interface FamilySpec {
  // Shown to teachers in "Only … are accepted."
  description: string;
  pipeline: UploadPipeline;
  // Whether application/octet-stream is acceptable. A missing type is always
  // judged by the extension; a video declared as octet-stream is refused
  // because its stored type is verified on completion.
  allowsGenericContentType: boolean;
}

const FAMILIES: Record<UploadFamily, FamilySpec> = {
  pdf: { description: "PDF documents", pipeline: "document", allowsGenericContentType: true },
  office: { description: "Word or PowerPoint files (DOCX, PPTX)", pipeline: "document", allowsGenericContentType: true },
  "legacy-word": { description: "Word 97-2003 files (DOC)", pipeline: "document", allowsGenericContentType: true },
  image: { description: "images (PNG, JPG, WEBP, GIF)", pipeline: "document", allowsGenericContentType: true },
  text: { description: "text and code files", pipeline: "text", allowsGenericContentType: true },
  video: { description: "MP4 or WebM videos", pipeline: "video", allowsGenericContentType: false },
};

// Families are listed in the order teachers should read them.
const FAMILY_ORDER: readonly UploadFamily[] = ["pdf", "office", "legacy-word", "image", "text", "video"];

interface FormatSpec {
  family: UploadFamily;
  label: string;
  // The first entry is the canonical type. "text/*" matches any text type.
  contentTypes: readonly string[];
}

const OOXML = "application/vnd.openxmlformats-officedocument";
const ZIP_TYPES = ["application/zip", "application/x-zip-compressed"];
const TEXT_TYPES = ["text/plain", "text/*"];

const FORMATS: Record<string, FormatSpec> = {
  pdf: { family: "pdf", label: "PDF", contentTypes: ["application/pdf", "application/x-pdf"] },
  mp4: { family: "video", label: "MP4", contentTypes: ["video/mp4"] },
  webm: { family: "video", label: "WebM", contentTypes: ["video/webm"] },
  docx: { family: "office", label: "DOCX", contentTypes: [`${OOXML}.wordprocessingml.document`, ...ZIP_TYPES] },
  pptx: { family: "office", label: "PPTX", contentTypes: [`${OOXML}.presentationml.presentation`, ...ZIP_TYPES] },
  doc: { family: "legacy-word", label: "DOC", contentTypes: ["application/msword"] },
  png: { family: "image", label: "PNG", contentTypes: ["image/png"] },
  jpg: { family: "image", label: "JPEG", contentTypes: ["image/jpeg"] },
  jpeg: { family: "image", label: "JPEG", contentTypes: ["image/jpeg"] },
  webp: { family: "image", label: "WebP", contentTypes: ["image/webp"] },
  gif: { family: "image", label: "GIF", contentTypes: ["image/gif"] },
  ...Object.fromEntries(
    ["txt", "md", "markdown", "csv", "json", "ts", "tsx", "js", "jsx", "py", "java", "go", "rb", "rs", "c", "cpp", "html", "css", "sql"]
      .map((extension): [string, FormatSpec] => [
        extension,
        {
          family: "text",
          label: extension.toUpperCase(),
          contentTypes: extension === "json" ? ["application/json", ...TEXT_TYPES] : TEXT_TYPES,
        },
      ]),
  ),
};

const GENERIC_CONTENT_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);

export interface UploadCandidate {
  // The teacher's original file name.
  fileName: string;
  // The type the browser or Storage reports. Never trusted on its own: it is
  // only checked for consistency with the extension.
  contentType?: string | null;
  // Where the bytes are stored, when known. Its extension must agree.
  storagePath?: string;
}

export type UploadRejectionReason = "unsupported_type" | "type_mismatch" | "content_mismatch";

export type UploadDecision =
  | {
    allowed: true;
    family: UploadFamily;
    extension: string;
    pipeline: UploadPipeline;
    // Canonical type to store the file with.
    contentType: string;
  }
  | { allowed: false; reason: UploadRejectionReason; message: string };

export type AllowedUpload = Extract<UploadDecision, { allowed: true }>;

export function fileExtension(fileName: string): string {
  const name = fileName.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function normalizeContentType(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function enabledFamilies(policy: UploadPolicy): UploadFamily[] {
  return FAMILY_ORDER.filter((family) => policy.enabledFamilies.includes(family));
}

// "PDF documents and MP4 or WebM videos"
export function acceptedUploadSummary(policy: UploadPolicy = UPLOAD_POLICY): string {
  return joinWithAnd(enabledFamilies(policy).map((family) => FAMILIES[family].description));
}

// "Only PDF documents and MP4 or WebM videos are accepted."
export function acceptedUploadSentence(policy: UploadPolicy = UPLOAD_POLICY): string {
  return `Only ${acceptedUploadSummary(policy)} are accepted.`;
}

// Value for <input type="file" accept>.
export function fileInputAccept(policy: UploadPolicy = UPLOAD_POLICY): string {
  return enabledFamilies(policy)
    .flatMap((family) =>
      Object.entries(FORMATS)
        .filter(([, format]) => format.family === family)
        .flatMap(([extension, format]) => [`.${extension}`, format.contentTypes[0]])
    )
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(",");
}

function contentTypeMatches(format: FormatSpec, contentType: string): boolean {
  return format.contentTypes.some((allowed) =>
    allowed.endsWith("/*") ? contentType.startsWith(allowed.slice(0, -1)) : contentType === allowed
  );
}

export function checkUpload(candidate: UploadCandidate, policy: UploadPolicy = UPLOAD_POLICY): UploadDecision {
  const { fileName } = candidate;
  const extension = fileExtension(fileName);
  const format = Object.prototype.hasOwnProperty.call(FORMATS, extension) ? FORMATS[extension] : undefined;
  if (!format || !policy.enabledFamilies.includes(format.family)) {
    return {
      allowed: false,
      reason: "unsupported_type",
      message: `"${fileName}" can't be uploaded. ${acceptedUploadSentence(policy)}`,
    };
  }

  if (candidate.storagePath !== undefined && fileExtension(candidate.storagePath) !== extension) {
    return {
      allowed: false,
      reason: "type_mismatch",
      message: `"${fileName}" can't be uploaded: the stored file doesn't match the .${extension} extension. ${acceptedUploadSentence(policy)}`,
    };
  }

  const contentType = normalizeContentType(candidate.contentType);
  const family = FAMILIES[format.family];
  const generic = GENERIC_CONTENT_TYPES.has(contentType);
  const reported = contentType !== "";
  if (reported && ((generic && !family.allowsGenericContentType) || (!generic && !contentTypeMatches(format, contentType)))) {
    return {
      allowed: false,
      reason: "type_mismatch",
      message: `"${fileName}" can't be uploaded: its file type (${contentType}) doesn't match the .${extension} extension. ${acceptedUploadSentence(policy)}`,
    };
  }

  return {
    allowed: true,
    family: format.family,
    extension,
    pipeline: family.pipeline,
    contentType: format.contentTypes[0] === "text/*" ? "text/plain" : format.contentTypes[0],
  };
}

// How far into a file its signature may start. PDF readers accept a header
// anywhere in the first 1024 bytes.
export const SIGNATURE_SEARCH_BYTES = 1024;

const startsWith = (head: Uint8Array, signature: readonly number[], offset = 0) =>
  head.length >= offset + signature.length && signature.every((byte, index) => head[offset + index] === byte);

const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));

function containsWithin(head: Uint8Array, signature: readonly number[], limit: number): boolean {
  const last = Math.min(head.length, limit) - signature.length;
  for (let offset = 0; offset <= last; offset += 1) {
    if (startsWith(head, signature, offset)) return true;
  }
  return false;
}

const PDF_SIGNATURE = ascii("%PDF-");
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// Checks the first bytes of a stored document against its format. This is a
// signature check only: it shows the bytes are the claimed container (a PDF,
// a ZIP for DOCX/PPTX, …), not that the file is well formed. Videos and text
// have no check here; their bytes are not inspected at admission.
const SIGNATURES: Partial<Record<string, (head: Uint8Array) => boolean>> = {
  pdf: (head) => containsWithin(head, PDF_SIGNATURE, SIGNATURE_SEARCH_BYTES),
  docx: (head) => startsWith(head, ZIP_SIGNATURE),
  pptx: (head) => startsWith(head, ZIP_SIGNATURE),
  doc: (head) => startsWith(head, OLE_SIGNATURE),
  png: (head) => startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (head) => startsWith(head, [0xff, 0xd8, 0xff]),
  jpeg: (head) => startsWith(head, [0xff, 0xd8, 0xff]),
  gif: (head) => startsWith(head, ascii("GIF8")),
  webp: (head) => startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8),
};

export function checkUploadContents(
  fileName: string,
  decision: AllowedUpload,
  head: Uint8Array,
  policy: UploadPolicy = UPLOAD_POLICY,
): UploadDecision {
  const matches = SIGNATURES[decision.extension];
  if (!matches || matches(head)) return decision;
  return {
    allowed: false,
    reason: "content_mismatch",
    message: `"${fileName}" can't be uploaded: its contents aren't a valid ${FORMATS[decision.extension].label} file. ${acceptedUploadSentence(policy)}`,
  };
}

// For callers that only see a declared type, such as the legacy video proxy.
export function checkVideoContentType(
  contentType: string | null | undefined,
  policy: UploadPolicy = UPLOAD_POLICY,
): UploadDecision {
  const normalized = normalizeContentType(contentType);
  const entry = Object.entries(FORMATS).find(([, format]) =>
    format.family === "video" && policy.enabledFamilies.includes("video") && format.contentTypes.includes(normalized)
  );
  if (!entry) {
    return { allowed: false, reason: "unsupported_type", message: acceptedUploadSentence(policy) };
  }
  const [extension, format] = entry;
  return { allowed: true, family: "video", extension, pipeline: "video", contentType: format.contentTypes[0] };
}

export interface UploadRejectionBody {
  error: string;
  code: UploadRejectionReason;
}

export function uploadRejectionBody(decision: Extract<UploadDecision, { allowed: false }>): UploadRejectionBody {
  return { error: decision.message, code: decision.reason };
}
