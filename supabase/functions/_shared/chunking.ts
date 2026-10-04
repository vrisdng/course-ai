// Fixed-size sliding-window text chunking shared by ingest-material and process-material-job.
export interface TextChunk {
  text: string;
  start: number;
  end: number;
}

// Normalize C0 controls to spaces so extracted separators do not join words.
// Keep \n and \r; \u0000 cannot be stored in Postgres text.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_SEPARATORS = /[\u0000-\u0009\u000B\u000C\u000E-\u001F]/g;

// Postgres rejects unpaired UTF-16 surrogates in JSON. Remove them separately,
// preserving valid pairs such as mathematical symbols and emoji.
const LONE_SURROGATES =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Moves an index that falls between the two halves of a surrogate pair back to the pair's start.
function alignToCodePoint(text: string, index: number): number {
  return index > 0 && index < text.length && isLowSurrogate(text.charCodeAt(index)) ? index - 1 : index;
}

export function chunkText(text: string, chunkSize: number, overlap: number): TextChunk[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(CONTROL_SEPARATORS, " ")
    .replace(LONE_SURROGATES, "");
  const cleaned = normalized.replace(/[ ]{2,}/g, " ").trim();
  if (!cleaned) return [];

  const safeChunkSize = Math.max(200, chunkSize);
  const safeOverlap = Math.min(Math.max(0, overlap), Math.floor(safeChunkSize * 0.5));
  const step = Math.max(1, safeChunkSize - safeOverlap);

  const chunks: TextChunk[] = [];
  for (let windowStart = 0; windowStart < cleaned.length; windowStart += step) {
    const start = alignToCodePoint(cleaned, windowStart);
    const end = alignToCodePoint(cleaned, Math.min(windowStart + safeChunkSize, cleaned.length));
    const slice = cleaned.slice(start, end).trim();
    if (slice) {
      chunks.push({ text: slice, start, end });
    }
  }
  return chunks;
}
