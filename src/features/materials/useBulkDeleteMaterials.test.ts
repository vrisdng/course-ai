import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  invoke: vi.fn(),
  storageFrom: vi.fn(),
  remove: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mocks.from,
    functions: { invoke: mocks.invoke },
    storage: { from: mocks.storageFrom },
  },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { useBulkDeleteMaterials } from './useBulkDeleteMaterials';

interface Chain {
  select: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
}

function makeChain(options: { rows?: unknown[]; error?: { message: string } | null } = {}): Chain {
  const chain = {
    select: vi.fn(),
    delete: vi.fn(),
    in: vi.fn(),
  } as unknown as Chain;
  chain.select.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.in.mockResolvedValue(
    options.rows
      ? { data: options.rows, error: options.error ?? null }
      : { data: null, error: options.error ?? null }
  );
  return chain;
}

// The hook fetches the selected rows from `materials`, then deletes from
// `chunks` and `materials`. Each test declares what the fetch returns.
function mockDatabase(options: { rows?: unknown[]; chunksError?: { message: string }; fetchError?: { message: string } } = {}) {
  const chunksChain = makeChain({ error: options.chunksError ?? null });
  const materialsChain = makeChain({ rows: options.rows ?? [], error: options.fetchError ?? null });
  mocks.from.mockImplementation((table: string) => (table === 'chunks' ? chunksChain : materialsChain));
  return { chunksChain, materialsChain };
}

const videoRow = { id: 'v1', file_type: 'video', file_path: 'course-materials/videos/v1.mp4', video_upload_state: 'uploaded' };
const videoRow2 = { id: 'v2', file_type: 'video', file_path: 'course-materials/videos/v2.mp4', video_upload_state: 'uploaded' };
const documentRow = { id: 'd1', file_type: 'pdf', file_path: 'course-materials/docs/d1.pdf', video_upload_state: null };

describe('useBulkDeleteMaterials', () => {
  const onDeleted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase();
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
    mocks.storageFrom.mockReturnValue({ remove: mocks.remove });
    mocks.remove.mockResolvedValue({ error: null });
    onDeleted.mockResolvedValue(undefined);
  });

  it('opens and closes the confirm dialog and refuses to close while deleting', async () => {
    mockDatabase({ rows: [videoRow] });
    let resolveInvoke: ((value: { data: Record<string, never>; error: null }) => void) | undefined;
    mocks.invoke.mockImplementation(
      () => new Promise<{ data: Record<string, never>; error: null }>((resolve) => { resolveInvoke = resolve; })
    );
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));

    expect(result.current.isDialogOpen).toBe(false);
    act(() => result.current.openDialog());
    expect(result.current.isDialogOpen).toBe(true);

    let deletePromise: Promise<void> | undefined;
    act(() => {
      deletePromise = result.current.deleteSelected(['v1']);
    });
    expect(result.current.isDeleting).toBe(true);

    act(() => result.current.closeDialog());
    expect(result.current.isDialogOpen).toBe(true);

    // Flush the fetch so the video deletion call starts and the gate exists.
    await act(async () => {});
    expect(resolveInvoke).toBeDefined();

    act(() => resolveInvoke?.({ data: {}, error: null }));
    await act(async () => deletePromise);
    expect(result.current.isDeleting).toBe(false);

    act(() => result.current.closeDialog());
    expect(result.current.isDialogOpen).toBe(false);
  });

  it('ignores empty selections', async () => {
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));

    await act(async () => result.current.deleteSelected([]));

    expect(mocks.from).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('batch-deletes documents, their chunks and stored files, then refreshes', async () => {
    const { chunksChain, materialsChain } = mockDatabase({ rows: [documentRow, { ...documentRow, id: 'd2' }] });
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));
    act(() => result.current.openDialog());

    await act(async () => result.current.deleteSelected(['d1', 'd2']));

    expect(materialsChain.select).toHaveBeenCalledWith('id, file_type, file_path, video_upload_state');
    expect(chunksChain.delete).toHaveBeenCalled();
    expect(chunksChain.in).toHaveBeenCalledWith('material_id', ['d1', 'd2']);
    expect(materialsChain.delete).toHaveBeenCalled();
    expect(materialsChain.in).toHaveBeenCalledWith('id', ['d1', 'd2']);
    expect(mocks.storageFrom).toHaveBeenCalledWith('course-materials');
    expect(mocks.remove).toHaveBeenCalledWith(['course-materials/docs/d1.pdf']);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Deleted 2 materials');
    expect(result.current.isDialogOpen).toBe(false);
  });

  it('routes stored videos through video-upload-session deletion', async () => {
    mockDatabase({ rows: [videoRow] });
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));

    await act(async () => result.current.deleteSelected(['v1']));

    expect(mocks.invoke).toHaveBeenCalledWith('video-upload-session', {
      body: { action: 'delete', materialId: 'v1' },
    });
    expect(onDeleted).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Deleted 1 material');
  });

  it('handles a mixed selection: documents in batches, videos one by one', async () => {
    mockDatabase({ rows: [videoRow, documentRow] });
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));

    await act(async () => result.current.deleteSelected(['v1', 'd1']));

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(['course-materials/docs/d1.pdf']);
    expect(onDeleted).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Deleted 2 materials');
  });

  it('keeps the dialog open when deleting chunks fails', async () => {
    mockDatabase({ rows: [documentRow], chunksError: { message: 'Chunk delete denied' } });
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));
    act(() => result.current.openDialog());

    await act(async () => result.current.deleteSelected(['d1']));

    expect(mocks.toastError).toHaveBeenCalledWith('Chunk delete denied');
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.isDialogOpen).toBe(true);
  });

  it('reports partial failures and still refreshes the list', async () => {
    mockDatabase({ rows: [videoRow, videoRow2] });
    mocks.invoke
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: { error: 'R2 unavailable' }, error: null });
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));

    await act(async () => result.current.deleteSelected(['v1', 'v2']));

    expect(mocks.toastError).toHaveBeenCalledWith('Deleted 1 material, but 1 failed to delete');
    expect(onDeleted).toHaveBeenCalled();
    expect(result.current.isDialogOpen).toBe(false);
  });

  it('reports a total failure when every video deletion fails', async () => {
    mockDatabase({ rows: [videoRow, videoRow2] });
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'Session delete failed' } });
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));
    act(() => result.current.openDialog());

    await act(async () => result.current.deleteSelected(['v1', 'v2']));

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to delete 2 materials');
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.isDialogOpen).toBe(true);
  });

  it('surfaces an error when the selected materials cannot be loaded', async () => {
    mockDatabase({ fetchError: { message: 'Load denied' } });
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));
    act(() => result.current.openDialog());

    await act(async () => result.current.deleteSelected(['d1']));

    expect(mocks.toastError).toHaveBeenCalledWith('Load denied');
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.isDialogOpen).toBe(true);
  });

  it('reports when none of the selected materials were found', async () => {
    mockDatabase({ rows: [] });
    const { result } = renderHook(() => useBulkDeleteMaterials({ onDeleted }));
    act(() => result.current.openDialog());

    await act(async () => result.current.deleteSelected(['gone-1']));

    expect(mocks.toastError).toHaveBeenCalledWith('The selected materials could not be found');
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.isDialogOpen).toBe(true);
  });
});
