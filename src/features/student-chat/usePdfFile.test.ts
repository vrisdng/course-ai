import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCachedPdf: vi.fn() }));
vi.mock('./pdfCache', () => ({ getCachedPdf: (...args: unknown[]) => mocks.getCachedPdf(...args) }));

import type { ActiveViewerSource } from './documentViewer';
import { usePdfFile } from './usePdfFile';

const source = (overrides: Partial<ActiveViewerSource>): ActiveViewerSource => ({ kind: 'pdf', documentName: 'Notes', ...overrides });

describe('usePdfFile', () => {
  const createObjectURL = vi.fn(() => 'blob:local/1');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    mocks.getCachedPdf.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('serves the cached download for a source whose storage location is known', async () => {
    const blob = new Blob(['%PDF']);
    mocks.getCachedPdf.mockResolvedValue(blob);
    const storage = { bucket: 'course-materials' as const, path: 'c/a.pdf' };

    const { result, unmount } = renderHook(() => usePdfFile(source({ storage, signedUrl: 'https://old.test/expired' })));

    expect(result.current).toEqual({ file: null, status: 'loading' });
    await waitFor(() => expect(result.current).toEqual({ file: 'blob:local/1', status: 'ready' }));
    expect(mocks.getCachedPdf).toHaveBeenCalledWith(storage);
    expect(createObjectURL).toHaveBeenCalledWith(blob);

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local/1');
  });

  it('reports a failed download', async () => {
    mocks.getCachedPdf.mockRejectedValue(new Error('PDF download failed (404)'));
    const { result } = renderHook(() => usePdfFile(source({ storage: { bucket: 'course-materials', path: 'c/a.pdf' } })));
    await waitFor(() => expect(result.current).toEqual({ file: null, status: 'error' }));
  });

  it('falls back to the signed link when the storage location is unknown', () => {
    const { result } = renderHook(() => usePdfFile(source({ signedUrl: 'https://signed.test/a.pdf' })));
    expect(result.current).toEqual({ file: 'https://signed.test/a.pdf', status: 'ready' });
    expect(mocks.getCachedPdf).not.toHaveBeenCalled();
  });

  it('has nothing to show without either', () => {
    const { result } = renderHook(() => usePdfFile(source({})));
    expect(result.current).toEqual({ file: null, status: 'none' });
  });
});
