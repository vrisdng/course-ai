import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: (...args: unknown[]) => mocks.storageFrom(...args) } },
}));

import { MAX_CACHED_PDFS, PDF_LINK_TTL_SECONDS, clearPdfCache, getCachedPdf } from './pdfCache';

const storage = (path: string) => ({ bucket: 'course-materials' as const, path });

describe('getCachedPdf', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearPdfCache();
    fetchMock.mockReset();
    mocks.createSignedUrl.mockReset();
    mocks.storageFrom.mockReturnValue({ createSignedUrl: mocks.createSignedUrl });
    mocks.createSignedUrl.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }));
    fetchMock.mockImplementation(async (url: string) => new Response(new Blob([`pdf from ${url}`])));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('downloads a PDF once with a fresh link, then serves it from memory', async () => {
    const first = await getCachedPdf(storage('c/a.pdf'));
    const second = await getCachedPdf(storage('c/a.pdf'));

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledWith('https://signed.test/c/a.pdf');
    expect(mocks.storageFrom).toHaveBeenCalledWith('course-materials');
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('c/a.pdf', PDF_LINK_TTL_SECONDS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one download between callers that ask at the same time', async () => {
    await Promise.all([getCachedPdf(storage('c/a.pdf')), getCachedPdf(storage('c/a.pdf'))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it(`keeps only the ${MAX_CACHED_PDFS} most recently used PDFs`, async () => {
    await getCachedPdf(storage('c/1.pdf'));
    await getCachedPdf(storage('c/2.pdf'));
    await getCachedPdf(storage('c/3.pdf'));
    await getCachedPdf(storage('c/1.pdf')); // touch 1, so 2 is now the oldest
    await getCachedPdf(storage('c/4.pdf'));
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await getCachedPdf(storage('c/1.pdf'));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await getCachedPdf(storage('c/2.pdf'));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not keep a failed download, so the next attempt retries', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gone', { status: 404 }));
    await expect(getCachedPdf(storage('c/a.pdf'))).rejects.toThrow('PDF download failed (404)');

    expect((await getCachedPdf(storage('c/a.pdf'))).size).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails clearly when a link cannot be created', async () => {
    mocks.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(getCachedPdf(storage('c/a.pdf'))).rejects.toThrow('denied');
  });
});
