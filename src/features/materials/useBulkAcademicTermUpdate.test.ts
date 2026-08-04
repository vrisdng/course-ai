import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { useBulkAcademicTermUpdate } from './useBulkAcademicTermUpdate';

function updateChain(error: unknown = null) {
  const value: Record<string, unknown> = {};
  value.update = vi.fn(() => value);
  value.in = vi.fn(() => value);
  value.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ error }).then(resolve);
  return value;
}

describe('useBulkAcademicTermUpdate', () => {
  const onUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(() => updateChain());
    onUpdated.mockResolvedValue(undefined);
  });

  it('enters selection mode and tracks individual and page selections', () => {
    const { result } = renderHook(() => useBulkAcademicTermUpdate({ onUpdated }));

    act(() => result.current.startSelecting());
    act(() => result.current.toggleMaterial('m1'));
    expect(result.current.isSelecting).toBe(true);
    expect(result.current.selectedMaterialIds).toEqual(new Set(['m1']));

    act(() => result.current.togglePage(['m1', 'm2'], true));
    expect(result.current.selectedMaterialIds).toEqual(new Set(['m1', 'm2']));

    act(() => result.current.togglePage(['m1', 'm2'], false));
    expect(result.current.selectedMaterialIds.size).toBe(0);
  });

  it('updates all selected materials and resets the workflow', async () => {
    const { result } = renderHook(() => useBulkAcademicTermUpdate({ onUpdated }));
    act(() => result.current.startSelecting());
    act(() => result.current.togglePage(['m1', 'm2'], true));
    act(() => result.current.openDialog());
    act(() => result.current.setTargetAcademicTermId('term-2'));

    await act(async () => result.current.save());

    const query = mocks.from.mock.results[0].value;
    expect(mocks.from).toHaveBeenCalledWith('materials');
    expect(query.update).toHaveBeenCalledWith({ academic_term_id: 'term-2' });
    expect(query.in).toHaveBeenCalledWith('id', ['m1', 'm2']);
    expect(onUpdated).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Academic term updated for 2 materials');
    expect(result.current.isSelecting).toBe(false);
    expect(result.current.isDialogOpen).toBe(false);
    expect(result.current.selectedMaterialIds.size).toBe(0);
  });

  it('keeps the selection available when the database update fails', async () => {
    mocks.from.mockReturnValueOnce(updateChain({ message: 'Update denied' }));
    const { result } = renderHook(() => useBulkAcademicTermUpdate({ onUpdated }));
    act(() => result.current.startSelecting());
    act(() => result.current.toggleMaterial('m1'));
    act(() => result.current.openDialog());
    act(() => result.current.setTargetAcademicTermId('term-2'));

    await act(async () => result.current.save());

    expect(mocks.toastError).toHaveBeenCalledWith('Update denied');
    expect(result.current.isSelecting).toBe(true);
    expect(result.current.isDialogOpen).toBe(true);
    expect(result.current.selectedMaterialIds).toEqual(new Set(['m1']));
  });
});
