import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Material } from './types';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), invoke: vi.fn(), storageFrom: vi.fn(), remove: vi.fn(),
  toastError: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from, functions: { invoke: mocks.invoke }, storage: { from: mocks.storageFrom } },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { useMaterialActions } from './useMaterialActions';

function chain(result: { data?: unknown; error: unknown }) {
  const value: Record<string, unknown> = {};
  for (const method of ['update', 'eq', 'select', 'order', 'delete']) value[method] = vi.fn(() => value);
  value.then = (resolve: (result: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return value;
}
const material = { id: 'm1', file_name: 'Lecture.pdf', file_path: 'course/lecture.pdf', linked_url: null } as Material;

describe('useMaterialActions', () => {
  const onMaterialsChanged = vi.fn();
  const setMaterials = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(() => chain({ data: [], error: null }));
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
    mocks.remove.mockResolvedValue({ data: null, error: null });
    mocks.storageFrom.mockReturnValue({ remove: mocks.remove });
    onMaterialsChanged.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  const setup = () => renderHook(() => useMaterialActions({ onMaterialsChanged, setMaterials })).result;

  it('opens, closes, and successfully saves a trimmed linked URL', async () => {
    const result = setup();
    act(() => result.current.handleAttachLink({ ...material, linked_url: ' https://old.test ' }));
    expect(result.current.linkedUrlValue).toBe(' https://old.test ');
    act(() => result.current.setLinkedUrlValue('  https://new.test  '));
    await act(async () => result.current.handleSaveLinkedUrl());
    const db = mocks.from.mock.results[0].value;
    expect(db.update).toHaveBeenCalledWith({ linked_url: 'https://new.test' });
    expect(setMaterials).toHaveBeenCalled();
    const updater = setMaterials.mock.calls[0][0];
    expect(updater([material, { ...material, id: 'm2' }])).toEqual([
      { ...material, linked_url: 'https://new.test' }, { ...material, id: 'm2' },
    ]);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('URL saved');
    expect(result.current.linkedUrlMaterial).toBeNull();
  });

  it('keeps the link dialog open and reports database failures', async () => {
    mocks.from.mockReturnValueOnce(chain({ error: { message: 'invalid URL' } }));
    const result = setup();
    act(() => result.current.handleAttachLink(material));
    await act(async () => result.current.handleSaveLinkedUrl());
    expect(mocks.toastError).toHaveBeenCalledWith('invalid URL');
    expect(result.current.linkedUrlMaterial).toEqual(material);
  });

  it('loads ordered transcript segments and can clear the dialog', async () => {
    const segments = [{ id: 's1', segment_index: 0, start_ms: 0, end_ms: 10, text: 'hello' }];
    mocks.from.mockReturnValueOnce(chain({ data: segments, error: null }));
    const result = setup();
    await act(async () => result.current.handleOpenTranscript(material));
    expect(result.current.transcriptSegments).toEqual(segments);
    expect(result.current.isLoadingTranscript).toBe(false);
    act(() => result.current.closeTranscriptDialog());
    expect(result.current.transcriptMaterial).toBeNull();
    expect(result.current.transcriptSegments).toEqual([]);
  });

  it('validates filenames, skips unchanged names, and updates changed names locally', async () => {
    const result = setup();
    act(() => result.current.openEditFileNameDialog(material));
    act(() => result.current.setEditingFileNameValue('   '));
    await act(async () => result.current.handleUpdateFileName());
    expect(mocks.toastError).toHaveBeenCalledWith('Filename is required');
    expect(mocks.from).not.toHaveBeenCalled();

    act(() => result.current.setEditingFileNameValue('Lecture.pdf'));
    await act(async () => result.current.handleUpdateFileName());
    expect(result.current.editingFileNameMaterial).toBeNull();

    act(() => { result.current.openEditFileNameDialog(material); result.current.setEditingFileNameValue('Renamed.pdf'); });
    await act(async () => result.current.handleUpdateFileName());
    expect(mocks.from.mock.results[0].value.update).toHaveBeenCalledWith({ file_name: 'Renamed.pdf' });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Filename updated');
  });

  it('tracks reindexing, refreshes on success, and reports application errors', async () => {
    const result = setup();
    await act(async () => result.current.handleReindexMaterial(material));
    expect(mocks.invoke).toHaveBeenCalledWith('transcribe-video', { body: { materialId: 'm1', refinalize: true } });
    expect(onMaterialsChanged).toHaveBeenCalled();
    expect(result.current.reindexingIds.has('m1')).toBe(false);
    mocks.invoke.mockResolvedValueOnce({ data: { error: 'No transcript' }, error: null });
    await act(async () => result.current.handleReindexMaterial(material));
    expect(mocks.toastError).toHaveBeenCalledWith('No transcript');
  });

  it('does nothing when deletion is cancelled and stops when chunk deletion fails', async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const result = setup();
    await act(async () => result.current.handleDeleteMaterial(material));
    expect(mocks.from).not.toHaveBeenCalled();

    mocks.from.mockReturnValueOnce(chain({ error: { message: 'chunks protected' } }));
    await act(async () => result.current.handleDeleteMaterial(material));
    expect(mocks.toastError).toHaveBeenCalledWith('chunks protected');
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it('deletes chunks, material metadata, and storage object before refreshing', async () => {
    const result = setup();
    await act(async () => result.current.handleDeleteMaterial(material));
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['chunks', 'materials']);
    expect(mocks.storageFrom).toHaveBeenCalledWith('course-materials');
    expect(mocks.remove).toHaveBeenCalledWith(['course/lecture.pdf']);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Document deleted');
    expect(onMaterialsChanged).toHaveBeenCalled();
  });
});
