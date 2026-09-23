// Pure helpers for document text extraction via Gemini Vision:
// base64 encoding, prompt construction, page-range planning, page-marker
// parsing, and retry/backoff. Kept free of Deno/Supabase imports so they can
// be unit tested with vitest.

export interface ExtractedSegment {
  text: string;
  pageNumber: number | null;
}

export interface PageRange {
  start: number;
  end: number;
}

// Encode bytes without materialising one string per byte. Chunks keep the
// argument count under the engine's apply() limit.
const BASE64_CHUNK_BYTES = 0x8000;

export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const slice = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

export function buildExtractionPrompt(options: { pageMarkers: boolean; range?: PageRange }): string {
  if (!options.pageMarkers) {
    return `Extract ALL text content from this document verbatim. Preserve the original structure including:
- Headings and subheadings
- Paragraphs
- Bullet points and numbered lists
- Table content (format as readable text)
- Captions and labels
- Any mathematical formulas (in plain text or LaTeX notation)
Do NOT summarize. Do NOT add commentary. Return ONLY the extracted text content.`;
  }

  const scope = options.range
    ? `Extract ALL text content from pages ${options.range.start} to ${options.range.end} of this document verbatim. Ignore every other page.`
    : 'Extract ALL text content from this document verbatim.';
  const inclusion = options.range
    ? `- Include only pages ${options.range.start} to ${options.range.end}, in order, labelled with the document's actual page numbers. If the document has fewer pages, stop at the last page.`
    : '- Include every page in order.';

  return `${scope}
Return output page-by-page in this exact format:
[Page 1]
<text from page 1>
[Page 2]
<text from page 2>
Rules:
- Keep page markers exactly as [Page N].
${inclusion}
- Do NOT summarize.
- Do NOT add commentary.
- Return ONLY extracted text content with these page markers.`;
}

export function parseGeminiPageSegments(rawText: string): ExtractedSegment[] {
  const markerRegex = /^\s*\[Page\s+(\d+)\]\s*$/gim;
  const markers = Array.from(rawText.matchAll(markerRegex));
  if (markers.length === 0) {
    return [];
  }

  const segments: ExtractedSegment[] = [];
  for (let i = 0; i < markers.length; i++) {
    const current = markers[i];
    const next = markers[i + 1];
    const pageNumber = Number(current[1]);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      continue;
    }
    const markerStart = current.index ?? 0;
    const markerEnd = markerStart + current[0].length;
    const segmentEnd = next?.index ?? rawText.length;
    const segmentText = rawText.slice(markerEnd, segmentEnd).trim();
    if (segmentText) {
      segments.push({ text: segmentText, pageNumber });
    }
  }
  return segments;
}

// The model is asked to label pages with their real numbers, but sometimes it
// restarts at 1 for the range it was given. Detect that and re-base, then drop
// anything that still falls outside the range.
export function normalizeRangeSegments(segments: ExtractedSegment[], range: PageRange): ExtractedSegment[] {
  const numbered = segments.filter((segment) => segment.pageNumber !== null);
  const rangeLength = range.end - range.start + 1;
  const restartedAtOne =
    range.start > 1 &&
    numbered.length > 0 &&
    numbered.every((segment) => segment.pageNumber! >= 1 && segment.pageNumber! <= rangeLength);

  const rebased = restartedAtOne
    ? numbered.map((segment) => ({ ...segment, pageNumber: segment.pageNumber! + range.start - 1 }))
    : numbered;

  return rebased.filter((segment) => segment.pageNumber! >= range.start && segment.pageNumber! <= range.end);
}

export function nextExtractionRange(options: {
  nextPage: number;
  totalPages: number;
  pagesPerCall: number;
}): PageRange | null {
  if (options.nextPage > options.totalPages) {
    return null;
  }
  return {
    start: options.nextPage,
    end: Math.min(options.nextPage + options.pagesPerCall - 1, options.totalPages),
  };
}

// Pages per OCR call, chosen from page density. Measured with gpt-5.6-luna:
// ~21 KB/page slide decks take ~40 s per 16 pages; a ~60 KB/page deck ran
// past 100 s on a 16-page range. Each call must finish well inside the Edge
// Runtime wall clock (150 s on the free plan) including claim + download.
export const MIN_PAGES_PER_CALL = 2;

export function initialPagesPerCall(options: { fileBytes: number; totalPages: number }): number {
  const bytesPerPage = options.fileBytes / Math.max(1, options.totalPages);
  if (bytesPerPage < 30_000) return 16;
  if (bytesPerPage < 80_000) return 8;
  return 4;
}

// After a call times out, retry the same pages in a smaller bite.
export function shrinkPagesPerCall(current: number): number {
  return Math.max(MIN_PAGES_PER_CALL, Math.floor(current / 2));
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

const BACKOFF_BASE_MS = 2000;
const BACKOFF_JITTER_MS = 1000;

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  return BACKOFF_BASE_MS * 2 ** attempt + Math.round(random() * BACKOFF_JITTER_MS);
}

export interface FetchWithRetryOptions {
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; status: number | null; delayMs: number }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Retries on 429/5xx and on network-level failures with exponential backoff.
// A non-retryable response is returned as-is for the caller to interpret.
export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(input, init);
      if (!isRetryableStatus(response.status)) {
        return response;
      }
      lastResponse = response;
      lastError = null;
    } catch (error) {
      // Aborts are the caller's decision (timeouts, cancelled requests): never retry them.
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      lastError = error;
      lastResponse = null;
    }

    if (attempt === maxRetries) {
      break;
    }
    const delayMs = backoffDelayMs(attempt);
    options.onRetry?.({ attempt: attempt + 1, status: lastResponse?.status ?? null, delayMs });
    await sleep(delayMs);
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError;
}
