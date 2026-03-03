export const INLINE_GEMINI_MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
export const OPENAI_WHISPER_VIDEO_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
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

  if (isVideoUpload(candidate) && candidate.size > OPENAI_WHISPER_VIDEO_MAX_FILE_SIZE_BYTES) {
    return `File too large (${formatFileSizeMb(candidate.size)}). MP4 and WebM video files must be 25MB or smaller.`;
  }

  return null;
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
