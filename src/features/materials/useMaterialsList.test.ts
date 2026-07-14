import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), toastError: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

import { useMaterialsList } from './useMaterialsList';

function query(result: { data: unknown; error: unknown; count: number | null }) {
  const chain: Record<string, ReturnType<typeof vi.fn> | ((resolve: (value: typeof result) => unknown) => Promise<unknown>)> = {};
  for (const method of ['select', 'order', 'eq', 'in', 'gte', 'or', 'range']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve) => Promise.resolve(result).then(resolve);
  return chain;
}

describe('useMaterialsList', () => {
  beforeEach(() => {
    mocks.from.mockReset(); mocks.toastError.mockReset();
    mocks.from.mockImplementation(() => query({ data: [], error: null, count: 0 }));
  });
  afterEach(() => vi.useRealTimers());

  it('loads the first page and computes visible pagination ranges', async () => {
    const rows = [{ id: 'm1', processing_status: 'completed' }];
    const chain = query({ data: rows, error: null, count: 23 });
    mocks.from.mockReturnValue(chain);
    const { result } = renderHook(() => useMaterialsList());
    await waitFor(() => expect(result.current.isLoadingMaterials).toBe(false));
    expect(mocks.from).toHaveBeenCalledWith('materials');
    expect(chain.range).toHaveBeenCalledWith(0, 9);
    expect(result.current.materials).toEqual(rows);
    expect(result.current.totalMaterialPages).toBe(3);
    expect(result.current.visibleMaterialRangeStart).toBe(1);
    expect(result.current.visibleMaterialRangeEnd).toBe(10);
  });

  it('applies field, type, date, and escaped search filters', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    const chains: ReturnType<typeof query>[] = [];
    mocks.from.mockImplementation(() => {
      const chain = query({ data: [], error: null, count: 0 }); chains.push(chain); return chain;
    });
    const { result } = renderHook(() => useMaterialsList());
    await act(async () => {});
    act(() => {
      result.current.setCourseFilter('course-1');
      result.current.setAcademicTermFilter('term-1');
      result.current.setStatusFilter('completed');
      result.current.setAccessFilter('private');
      result.current.setDocumentTypeFilter('notes');
      result.current.setDateFilter('last_7_days');
      result.current.setSearchQuery('week_1, 100%');
    });
    await act(async () => {});
    const latest = chains.at(-1)!;
    expect(latest.eq).toHaveBeenCalledWith('course_id', 'course-1');
    expect(latest.eq).toHaveBeenCalledWith('academic_term_id', 'term-1');
    expect(latest.eq).toHaveBeenCalledWith('processing_status', 'completed');
    expect(latest.eq).toHaveBeenCalledWith('access_scope', 'private');
    expect(latest.in).toHaveBeenCalledWith('file_type', ['notes', 'pdf', 'slides']);
    expect(latest.gte).toHaveBeenCalledWith('created_at', '2026-07-07T00:00:00.000Z');
    expect(latest.or).toHaveBeenCalledWith('file_name.ilike.%week\\_1\\, 100\\%%,topic.ilike.%week\\_1\\, 100\\%%');
  });

  it('changes pages, clamps pages after count shrink, and reports empty ranges', async () => {
    mocks.from.mockImplementation(() => query({ data: [], error: null, count: 25 }));
    const { result } = renderHook(() => useMaterialsList());
    await waitFor(() => expect(result.current.totalMaterialPages).toBe(3));
    act(() => result.current.setMaterialsPage(3));
    await waitFor(() => expect(result.current.visibleMaterialRangeStart).toBe(21));
    expect(result.current.visibleMaterialRangeEnd).toBe(25);

    mocks.from.mockImplementation(() => query({ data: [], error: null, count: 0 }));
    await act(async () => result.current.fetchMaterials());
    await waitFor(() => expect(result.current.materialsPage).toBe(1));
    expect(result.current.visibleMaterialRangeStart).toBe(0);
    expect(result.current.visibleMaterialRangeEnd).toBe(0);
  });

  it('reports fetch failures without discarding the existing material list', async () => {
    const row = { id: 'm1', processing_status: 'completed' };
    mocks.from.mockReturnValueOnce(query({ data: [row], error: null, count: 1 }));
    const { result } = renderHook(() => useMaterialsList());
    await waitFor(() => expect(result.current.materials).toEqual([row]));
    mocks.from.mockReturnValueOnce(query({ data: null, error: { message: 'offline' }, count: null }));
    await act(async () => result.current.fetchMaterials());
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to load materials');
    expect(result.current.materials).toEqual([row]);
    expect(result.current.isLoadingMaterials).toBe(false);
  });

  it('polls silently while a material is processing and stops after unmount', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    mocks.from.mockImplementation(() => query({ data: [{ id: 'm1', processing_status: 'processing' }], error: null, count: 1 }));
    const { unmount } = renderHook(() => useMaterialsList());
    await act(async () => {});
    expect(mocks.from).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(mocks.from.mock.calls.length).toBeGreaterThan(1);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
