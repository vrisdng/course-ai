import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));

import {
  MAX_CACHED_TRANSCRIPTS,
  TRANSCRIPT_PAGE_SIZE,
  clearTranscriptCache,
  getCachedTranscript,
  peekCachedTranscript,
} from './transcriptCache';

const segments = [
  { id: 's1', segment_index: 0, start_ms: 0, end_ms: 1_000, text: 'First.' },
  { id: 's2', segment_index: 1, start_ms: 1_000, end_ms: 2_000, text: 'Second.' },
];

function query(data: unknown, error: unknown = null) {
  const range = vi.fn(async () => ({ data, error }));
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) chain[method] = vi.fn(() => chain);
  chain.range = range;
  return chain;
}

function deferredQuery(data: unknown) {
  let resolveRange: ((value: unknown) => void) | null = null;
  const range = vi.fn(() => new Promise((resolve) => { resolveRange = resolve; }));
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) chain[method] = vi.fn(() => chain);
  chain.range = range;
  return {
    chain,
    resolve: () => resolveRange?.({ data, error: null }),
  };
}

describe('transcriptCache', () => {
  beforeEach(() => {
    clearTranscriptCache();
    mocks.from.mockReset();
  });

  it('downloads a transcript once, then serves it from memory', async () => {
    const chain = query(segments);
    mocks.from.mockReturnValue(chain);

    const first = await getCachedTranscript('m1');
    const second = await getCachedTranscript('m1');

    expect(second).toBe(first);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(chain.range).toHaveBeenCalledWith(0, TRANSCRIPT_PAGE_SIZE - 1);
    expect(peekCachedTranscript('m1')).toBe(first);
  });

  it('shares one request between callers that ask at the same time', async () => {
    mocks.from.mockReturnValue(query(segments));

    const [first, second] = await Promise.all([
      getCachedTranscript('m1'),
      getCachedTranscript('m1'),
    ]);

    expect(second).toBe(first);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('pages through the transcript and reports partial progress', async () => {
    const firstPage = Array.from({ length: TRANSCRIPT_PAGE_SIZE }, (_, index) => ({
      id: `s${index}`,
      segment_index: index,
      start_ms: index * 1_000,
      end_ms: index * 1_000 + 900,
      text: `Segment ${index}.`,
    }));
    const firstQuery = query(firstPage);
    const secondQuery = query([{ id: 'last', segment_index: 500, start_ms: 500_000, end_ms: 500_900, text: 'Last.' }]);
    mocks.from.mockReturnValueOnce(firstQuery).mockReturnValueOnce(secondQuery);
    const progress: number[] = [];

    const loaded = await getCachedTranscript('m1', (partial) => progress.push(partial.length));

    expect(loaded).toHaveLength(TRANSCRIPT_PAGE_SIZE + 1);
    expect(firstQuery.range).toHaveBeenCalledWith(0, TRANSCRIPT_PAGE_SIZE - 1);
    expect(secondQuery.range).toHaveBeenCalledWith(TRANSCRIPT_PAGE_SIZE, TRANSCRIPT_PAGE_SIZE * 2 - 1);
    expect(progress).toEqual([TRANSCRIPT_PAGE_SIZE, TRANSCRIPT_PAGE_SIZE + 1]);
  });

  it('does not keep a failed request, so the next attempt retries', async () => {
    mocks.from
      .mockReturnValueOnce(query(null, { message: 'offline' }))
      .mockReturnValueOnce(query(segments));

    await expect(getCachedTranscript('m1')).rejects.toMatchObject({ message: 'offline' });
    await expect(getCachedTranscript('m1')).resolves.toHaveLength(2);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it(`keeps only the ${MAX_CACHED_TRANSCRIPTS} most recently used transcripts`, async () => {
    mocks.from.mockImplementation(() => query(segments));

    await getCachedTranscript('m1');
    await getCachedTranscript('m2');
    await getCachedTranscript('m3');
    await getCachedTranscript('m1');
    await getCachedTranscript('m4');
    expect(mocks.from).toHaveBeenCalledTimes(4);

    await getCachedTranscript('m1');
    expect(mocks.from).toHaveBeenCalledTimes(4);
    await getCachedTranscript('m2');
    expect(mocks.from).toHaveBeenCalledTimes(5);
  });

  it('returns null from peek while the first request is still in flight', async () => {
    const pending = deferredQuery(segments);
    mocks.from.mockReturnValue(pending.chain);

    const request = getCachedTranscript('m1');
    expect(peekCachedTranscript('m1')).toBeNull();

    pending.resolve();
    await expect(request).resolves.toHaveLength(2);
    expect(peekCachedTranscript('m1')).toEqual(segments);
  });
});
