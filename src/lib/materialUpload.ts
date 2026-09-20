export const INLINE_GEMINI_MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
export const VIDEO_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB — AssemblyAI limit
export const AUDIO_CHUNK_MAX_BYTES = 20 * 1024 * 1024;
export const LARGE_VIDEO_CONFIRMATION_THRESHOLD_BYTES = 200 * 1024 * 1024;
export const TEXT_INGEST_MAX_CHARACTERS = 500_000;

const INLINE_GEMINI_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'doc',
]);

const TEXT_LIKE_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'java',
  'go',
  'rb',
  'rs',
  'c',
  'cpp',
  'html',
  'css',
  'sql',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
]);

export function getFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

export function usesInlineGeminiExtraction(candidate: Pick<File, 'name'>) {
  return INLINE_GEMINI_EXTENSIONS.has(getFileExtension(candidate.name));
}

export function isVideoUpload(candidate: Pick<File, 'name'>) {
  return VIDEO_EXTENSIONS.has(getFileExtension(candidate.name));
}

export function isTextLikeUpload(candidate: Pick<File, 'name' | 'type'>) {
  return candidate.type.startsWith('text/') || TEXT_LIKE_EXTENSIONS.has(getFileExtension(candidate.name));
}

export function getImmediateUploadValidationError(candidate: Pick<File, 'name' | 'size'>) {
  if (usesInlineGeminiExtraction(candidate) && candidate.size > INLINE_GEMINI_MAX_FILE_SIZE_BYTES) {
    return `File too large (${formatFileSizeMb(candidate.size)}). PDF, DOC, and image files must be 15MB or smaller.`;
  }

  if (isVideoUpload(candidate) && candidate.size > VIDEO_MAX_FILE_SIZE_BYTES) {
    return `File too large (${formatFileSizeMb(candidate.size)}). Video files must be 5GB or smaller.`;
  }

  return null;
}

// Mirror of the Supabase storage engine's VALID_OBJECT_KEY allowlist
// (https://github.com/supabase/storage/blob/master/src/storage/limits.ts:88).
const VALID_OBJECT_KEY_REGEX = /^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/;
export const ALLOWED_UPLOAD_KEY_CHARS = "letters, numbers, spaces, and / _ ! . * ' ( ) & = @ ; : + , - ?";

export function findFirstInvalidKeyChar(name: string): string | null {
  return name.split('').find((char) => !VALID_OBJECT_KEY_REGEX.test(char)) ?? null;
}

export function formatInvalidKeyMessage(name: string, char: string): string {
  return `File name "${name}" contains the character "${char}", which is not allowed. Use ${ALLOWED_UPLOAD_KEY_CHARS}.`;
}

export function getInvalidUploadKeyError(candidate: Pick<File, 'name'>): string | null {
  const invalidChar = findFirstInvalidKeyChar(candidate.name);
  return invalidChar ? formatInvalidKeyMessage(candidate.name, invalidChar) : null;
}

// Same set minus "/" (which would nest folders) — used to sanitise a single
// path segment derived from a user-supplied filename.
const DISALLOWED_FILENAME_CHAR_REGEX = /[^A-Za-z0-9_!.*'() &$=@;:+,?-]/g;
const MAX_STORAGE_STEM_LENGTH = 200;
const FALLBACK_STORAGE_STEM = 'file';

export function isStorageSafeKey(key: string): boolean {
  return key.length > 0 && VALID_OBJECT_KEY_REGEX.test(key);
}

function stripDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function sanitiseSegment(value: string): string {
  return stripDiacritics(value)
    .replace(DISALLOWED_FILENAME_CHAR_REGEX, '_')
    .replace(/_{2,}/g, '_')
    .replace(/ {2,}/g, ' ');
}

/**
 * Maps an arbitrary filename onto a Supabase-storage-safe path segment.
 * The extension is preserved so downstream parsers that read the type off the
 * storage path keep working; the original name should still be stored in
 * `materials.file_name` for display.
 */
export function toStorageSafeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const hasExtension = dotIndex > -1 && dotIndex < trimmed.length - 1;
  const rawStem = hasExtension ? trimmed.slice(0, dotIndex) : trimmed;
  const rawExtension = hasExtension ? trimmed.slice(dotIndex + 1) : '';

  let stem = sanitiseSegment(rawStem)
    .replace(/^[\s._]+|[\s._]+$/g, '')
    .slice(0, MAX_STORAGE_STEM_LENGTH)
    .replace(/[\s._]+$/g, '');
  if (!stem) {
    stem = FALLBACK_STORAGE_STEM;
  }

  const extension = sanitiseSegment(rawExtension).replace(/^[\s._]+|[\s._]+$/g, '');
  return extension ? `${stem}.${extension}` : stem;
}

export async function getDeferredUploadValidationError(candidate: File) {
  const immediateError = getImmediateUploadValidationError(candidate);
  if (immediateError) {
    return immediateError;
  }

  if (!isTextLikeUpload(candidate)) {
    return null;
  }

  const text = await candidate.text();
  if (text.length > TEXT_INGEST_MAX_CHARACTERS) {
    return `Text content exceeds the ${TEXT_INGEST_MAX_CHARACTERS.toLocaleString()} character limit. Split the file into smaller parts.`;
  }

  return null;
}

function formatFileSizeMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
