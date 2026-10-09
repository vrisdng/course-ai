import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  storageFrom: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mocks.from(...args),
    storage: { from: (...args: unknown[]) => mocks.storageFrom(...args) },
  },
}));

import { PAGE_IMAGE_URL_TTL_SECONDS, loadBlockBoxes, loadPageImage, pageImagePath } from './pageImage';

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'maybeSingle']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

describe('pageImagePath', () => {
  it('matches where ingestion uploads page images', () => {
    expect(pageImagePath('mat-1', 4)).toBe('page-images/mat-1/page-4.webp');
  });
});

describe('loadPageImage', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.createSignedUrl.mockReset();
    mocks.storageFrom.mockReturnValue({ createSignedUrl: mocks.createSignedUrl });
  });

  it('returns a signed URL and the rendered size for a rendered page', async () => {
    const pageQuery = query({ data: { width: 1400, height: 788 }, error: null });
    mocks.from.mockReturnValueOnce(pageQuery);
    mocks.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'https://img.test/p4' }, error: null });

    await expect(loadPageImage('mat-1', 4)).resolves.toEqual({ url: 'https://img.test/p4', width: 1400, height: 788 });
    expect(mocks.from).toHaveBeenCalledWith('material_pages');
    expect(pageQuery.eq).toHaveBeenCalledWith('material_id', 'mat-1');
    expect(pageQuery.eq).toHaveBeenCalledWith('page_number', 4);
    expect(mocks.storageFrom).toHaveBeenCalledWith('course-materials');
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('page-images/mat-1/page-4.webp', PAGE_IMAGE_URL_TTL_SECONDS);
  });

  it('returns null when the page has not been rendered', async () => {
    mocks.from.mockReturnValueOnce(query({ data: null, error: null }));
    await expect(loadPageImage('mat-1', 4)).resolves.toBeNull();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing when a lookup fails', async () => {
    mocks.from.mockReturnValueOnce(query({ data: null, error: { message: 'boom' } }));
    await expect(loadPageImage('mat-1', 4)).resolves.toBeNull();

    mocks.from.mockReturnValueOnce(query({ data: { width: 1400, height: 788 }, error: null }));
    mocks.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(loadPageImage('mat-1', 4)).resolves.toBeNull();
  });
});

describe('loadBlockBoxes', () => {
  beforeEach(() => mocks.from.mockReset());

  it("returns the first cited block's page and the boxes of the cited blocks on it, in citation order", async () => {
    const blocksQuery = query({
      data: [
        { id: 'b3', page_number: 4, box: [0.1, 0.1, 0.5, 0.2] },
        { id: 'b1', page_number: 3, box: [0.1, 0.5, 0.9, 0.6] },
        { id: 'b2', page_number: 3, box: [0.1, 0.7, 0.9, 0.8] },
      ],
      error: null,
    });
    mocks.from.mockReturnValueOnce(blocksQuery);

    await expect(loadBlockBoxes(['b1', 'b2', 'b3'])).resolves.toEqual({
      pageNumber: 3,
      boxes: [
        [0.1, 0.5, 0.9, 0.6],
        [0.1, 0.7, 0.9, 0.8],
      ],
    });
    expect(mocks.from).toHaveBeenCalledWith('page_blocks');
    expect(blocksQuery.in).toHaveBeenCalledWith('id', ['b1', 'b2', 'b3']);
  });

  it('skips blocks without a usable box', async () => {
    mocks.from.mockReturnValueOnce(query({ data: [{ id: 'b1', page_number: 2, box: null }, { id: 'b2', page_number: 2, box: [0.1, 0.1, 0.2, 0.2] }], error: null }));
    await expect(loadBlockBoxes(['b1', 'b2'])).resolves.toEqual({ pageNumber: 2, boxes: [[0.1, 0.1, 0.2, 0.2]] });
  });

  it('returns null when nothing can be read', async () => {
    await expect(loadBlockBoxes([])).resolves.toBeNull();
    mocks.from.mockReturnValueOnce(query({ data: null, error: { message: 'denied' } }));
    await expect(loadBlockBoxes(['b1'])).resolves.toBeNull();
  });
});
