// Fixed-size sliding-window text chunking shared by ingest-material and process-material-job.
export interface TextChunk {
  text: string;
  start: number;
  end: number;
}

export function chunkText(text: string, chunkSize: number, overlap: number): TextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\t/g, " ");
  const cleaned = normalized.replace(/[ ]{2,}/g, " ").trim();
  if (!cleaned) return [];

  const safeChunkSize = Math.max(200, chunkSize);
  const safeOverlap = Math.min(Math.max(0, overlap), Math.floor(safeChunkSize * 0.5));
  const step = Math.max(1, safeChunkSize - safeOverlap);

  const chunks: TextChunk[] = [];
  for (let start = 0; start < cleaned.length; start += step) {
    const end = Math.min(start + safeChunkSize, cleaned.length);
    const slice = cleaned.slice(start, end).trim();
    if (slice) {
      chunks.push({ text: slice, start, end });
    }
  }
  return chunks;
}
