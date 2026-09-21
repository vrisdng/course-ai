import { describe, expect, it, vi } from 'vitest';
import {
  backoffDelayMs,
  buildExtractionPrompt,
  encodeBytesToBase64,
  fetchWithRetry,
  isRetryableStatus,
  nextExtractionRange,
  normalizeRangeSegments,
  parseGeminiPageSegments,
} from './extraction';

describe('encodeBytesToBase64', () => {
  it('matches the reference encoder for empty, small, and chunk-boundary inputs', () => {
    for (const size of [0, 1, 2, 3, 100, 0x8000 - 1, 0x8000, 0x8000 + 1, 200_000]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
      expect(encodeBytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});

describe('buildExtractionPrompt', () => {
  it('asks for every page when no range is given', () => {
    const prompt = buildExtractionPrompt({ pageMarkers: true });
    expect(prompt).toContain('Include every page in order');
    expect(prompt).toContain('[Page 1]');
  });

  it('restricts to the requested page range using the document page numbers', () => {
    const prompt = buildExtractionPrompt({ pageMarkers: true, range: { start: 17, end: 32 } });
    expect(prompt).toContain('pages 17 to 32');
    expect(prompt).toContain("document's actual page numbers");
    expect(prompt).not.toContain('Include every page');
  });

  it('omits page markers for single-image extraction', () => {
    const prompt = buildExtractionPrompt({ pageMarkers: false });
    expect(prompt).not.toContain('[Page');
    expect(prompt).toContain('Preserve the original structure');
  });
});

describe('parseGeminiPageSegments', () => {
  it('splits marked text into page segments and drops empty pages', () => {
    const segments = parseGeminiPageSegments('[Page 1]\nintro\n[Page 2]\n\n[Page 3]\nbody');
    expect(segments).toEqual([
      { text: 'intro', pageNumber: 1 },
      { text: 'body', pageNumber: 3 },
    ]);
  });

  it('returns nothing when there are no markers', () => {
    expect(parseGeminiPageSegments('just prose')).toEqual([]);
  });
});

describe('normalizeRangeSegments', () => {
  const range = { start: 17, end: 20 };

  it('keeps segments whose page numbers fall inside the range', () => {
    const segments = [
      { text: 'a', pageNumber: 17 },
      { text: 'b', pageNumber: 20 },
      { text: 'stray', pageNumber: 3 },
    ];
    expect(normalizeRangeSegments(segments, range)).toEqual([
      { text: 'a', pageNumber: 17 },
      { text: 'b', pageNumber: 20 },
    ]);
  });

  it('re-bases segments when the model restarted numbering at 1 for the range', () => {
    const segments = [
      { text: 'a', pageNumber: 1 },
      { text: 'b', pageNumber: 2 },
      { text: 'c', pageNumber: 4 },
    ];
    expect(normalizeRangeSegments(segments, range)).toEqual([
      { text: 'a', pageNumber: 17 },
      { text: 'b', pageNumber: 18 },
      { text: 'c', pageNumber: 20 },
    ]);
  });

  it('does not re-base when the range starts at page 1', () => {
    const segments = [{ text: 'a', pageNumber: 1 }];
    expect(normalizeRangeSegments(segments, { start: 1, end: 16 })).toEqual(segments);
  });
});

describe('nextExtractionRange', () => {
  it('walks the document in fixed-size windows and clamps the last one', () => {
    expect(nextExtractionRange({ nextPage: 1, totalPages: 47, pagesPerCall: 16 })).toEqual({ start: 1, end: 16 });
    expect(nextExtractionRange({ nextPage: 33, totalPages: 47, pagesPerCall: 16 })).toEqual({ start: 33, end: 47 });
  });

  it('returns null once every page has been extracted', () => {
    expect(nextExtractionRange({ nextPage: 48, totalPages: 47, pagesPerCall: 16 })).toBeNull();
  });
});

describe('retry helpers', () => {
  it('treats rate limiting, unavailability, and server errors as retryable', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it('grows the backoff exponentially with bounded jitter', () => {
    expect(backoffDelayMs(0, () => 0)).toBe(2000);
    expect(backoffDelayMs(1, () => 0)).toBe(4000);
    expect(backoffDelayMs(2, () => 0)).toBe(8000);
    expect(backoffDelayMs(2, () => 1)).toBe(8000 + 1000);
  });

  it('retries retryable responses and returns the first success', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const response = await fetchWithRetry('https://example.test', {}, { fetchImpl, sleep, maxRetries: 3 });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    const sleep = vi.fn();
    const response = await fetchWithRetry('https://example.test', {}, { fetchImpl, sleep, maxRetries: 3 });
    expect(response.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the retry budget and returns the last response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('busy', { status: 503 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const response = await fetchWithRetry('https://example.test', {}, { fetchImpl, sleep, maxRetries: 2 });
    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries network failures and rethrows once the budget is spent', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('connection reset'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(fetchWithRetry('https://example.test', {}, { fetchImpl, sleep, maxRetries: 1 })).rejects.toThrow('connection reset');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
