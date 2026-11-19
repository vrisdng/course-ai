// Images a student attaches to a question. The browser uploads each one to
// the private question-images bucket under "<user id>/<uuid>.<ext>" and sends
// the paths; rag-chat checks them, reads the bytes for the model, and links
// them to the saved question in message_attachments.

export const QUESTION_IMAGE_BUCKET = "question-images";
export const MAX_QUESTION_IMAGES = 4;
// Matches the bucket's file_size_limit.
export const MAX_QUESTION_IMAGE_BYTES = 5 * 1024 * 1024;
// Earlier images in the conversation replayed to the model, newest first.
export const MAX_HISTORY_IMAGES = 4;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FILE_NAME_PATTERN = new RegExp(`^${UUID}\\.(png|jpe?g|webp)$`, "i");

export interface QuestionImage {
  path: string;
  // Base64-encoded bytes (no data: prefix).
  base64Data: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AttachmentRow {
  message_id: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  position: number;
}

export type ParsedImagePaths = { ok: true; paths: string[] } | { ok: false; error: string };

export function contentTypeForImagePath(path: string): string | null {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? null;
}

// Only the caller's own uploads, in the expected shape, are accepted.
export function parseQuestionImagePaths(raw: unknown, userId: string): ParsedImagePaths {
  if (raw === undefined || raw === null) return { ok: true, paths: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Attached images must be a list." };
  const paths = [...new Set(raw)];
  if (paths.length > MAX_QUESTION_IMAGES) {
    return { ok: false, error: `Attach at most ${MAX_QUESTION_IMAGES} images.` };
  }
  const prefix = `${userId}/`;
  for (const path of paths) {
    if (typeof path !== "string" || !path.startsWith(prefix) || !FILE_NAME_PATTERN.test(path.slice(prefix.length))) {
      return { ok: false, error: "One of the attached images is invalid." };
    }
  }
  return { ok: true, paths: paths as string[] };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

// Reads each image with `download` (null when it can't be read).
export async function encodeQuestionImages(
  paths: string[],
  download: (path: string) => Promise<Uint8Array | null>,
): Promise<QuestionImage[]> {
  return await Promise.all(paths.map(async (path) => {
    const mimeType = contentTypeForImagePath(path);
    const bytes = mimeType ? await download(path) : null;
    if (!mimeType || !bytes) throw new Error("Couldn't read an attached image. Remove it and try again.");
    if (bytes.byteLength > MAX_QUESTION_IMAGE_BYTES) throw new Error("An attached image is too large.");
    return { path, base64Data: toBase64(bytes), mimeType, sizeBytes: bytes.byteLength };
  }));
}

export function attachmentRows(messageId: string, images: QuestionImage[]): AttachmentRow[] {
  return images.map((image, position) => ({
    message_id: messageId,
    storage_path: image.path,
    content_type: image.mimeType,
    size_bytes: image.sizeBytes,
    position,
  }));
}
