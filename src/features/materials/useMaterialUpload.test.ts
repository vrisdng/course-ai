import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), uploadStorage: vi.fn(), uploadVideo: vi.fn(), invoke: vi.fn(), from: vi.fn(),
  toastError: vi.fn(), toastSuccess: vi.fn(), toastInfo: vi.fn(),
}));
vi.mock('@supabase/supabase-js', async (importOriginal) => ({ ...(await importOriginal()), createClient: mocks.createClient }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/uploadWithProgress', () => ({ uploadToStorageWithProgress: mocks.uploadStorage }));
vi.mock('@/lib/videoUploadPipeline', () => ({ uploadVideoForTranscription: mocks.uploadVideo }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess, info: mocks.toastInfo } }));

import { useMaterialUpload } from './useMaterialUpload';

function insertChain(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  return { insert, select, single };
}
const file = (name: string, content = 'hello', type = '') => {
  const value = new File([content], name, { type, lastModified: 123 });
  Object.defineProperty(value, 'text', { value: async () => content });
  return value;
};

describe('useMaterialUpload', () => {
  const onUploaded = vi.fn();
  let db: ReturnType<typeof insertChain>;
  beforeEach(() => {
    vi.clearAllMocks();
    db = insertChain({ data: { id: 'material-1' }, error: null });
    mocks.from.mockReturnValue(db);
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
    mocks.createClient.mockReturnValue({ from: mocks.from, functions: { invoke: mocks.invoke } });
    mocks.uploadStorage.mockResolvedValue(undefined);
    mocks.uploadVideo.mockResolvedValue({ materialId: 'video-1' });
    onUploaded.mockResolvedValue(undefined);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid') });
  });
  const setup = (uploaderId: string | undefined = 'user-1') =>
    renderHook(() => useMaterialUpload({ uploaderId, onUploaded })).result;
  const add = (result: ReturnType<typeof setup>, files: File[], error: string | null = null) =>
    act(() => result.current.handleFileInputChange({ target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>, error));

  it('queues supported unique files and reports unsupported, oversized, and duplicate choices', () => {
    const result = setup();
    const pdf = file('notes.pdf');
    add(result, [pdf, pdf, file('virus.exe')]);
    expect(result.current.pendingFiles).toEqual([pdf]);
    expect(mocks.toastError).toHaveBeenCalledWith('Skipped 1 unsupported file.');
    const huge = file('huge.pdf');
    Object.defineProperty(huge, 'size', { value: 16 * 1024 * 1024 });
    add(result, [huge]);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('exceed the upload limits'));
    add(result, [pdf]);
    expect(mocks.toastInfo).toHaveBeenCalledWith('These files are already in your review list.');
  });

  it('enforces setup before selecting, opening, dragging, or dropping files', () => {
    const result = setup();
    add(result, [file('notes.txt')], 'Select a course');
    expect(result.current.pendingFiles).toEqual([]);
    const click = vi.fn();
    Object.defineProperty(result.current.fileInputRef, 'current', { value: { click, value: '' }, configurable: true });
    act(() => result.current.handleOpenFilePicker('Select a course'));
    expect(click).not.toHaveBeenCalled();
    act(() => result.current.handleOpenFilePicker(null));
    expect(click).toHaveBeenCalled();
    const preventDefault = vi.fn();
    act(() => result.current.handleDragOver({ preventDefault } as unknown as React.DragEvent<HTMLDivElement>, null));
    expect(result.current.isDragActive).toBe(true);
    act(() => result.current.handleDragLeave({ preventDefault } as unknown as React.DragEvent<HTMLDivElement>));
    expect(result.current.isDragActive).toBe(false);
  });

  it('uploads and directly ingests text with correct metadata and progress', async () => {
    const result = setup();
    const textFile = file('lesson.ts', 'export const answer = 42;', 'text/plain');
    add(result, [textFile]);
    await act(async () => result.current.handleUpload('course-1', 'public', 'term-1'));
    expect(mocks.uploadStorage).toHaveBeenCalledWith(expect.objectContaining({
      bucket: 'course-materials', path: 'course-1/uuid-lesson.ts', body: textFile,
    }));
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      course_id: 'course-1', academic_term_id: 'term-1', access_scope: 'public', is_public: true,
      file_type: 'code', uploaded_by: 'user-1',
    }));
    expect(mocks.invoke).toHaveBeenCalledWith('ingest-material', expect.objectContaining({
      body: { materialId: 'material-1', text: 'export const answer = 42;' },
    }));
    expect(onUploaded).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('1 material uploaded and indexed');
    expect(result.current.pendingFiles).toEqual([]);
  });

  it('queues parsed documents and delegates videos to the transcription pipeline', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { queued: true }, error: null });
    const result = setup();
    add(result, [file('slides.pdf')]);
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    expect(mocks.invoke).toHaveBeenCalledWith('parse-document', expect.objectContaining({
      body: { materialId: 'material-1', filePath: 'course-1/uuid-slides.pdf', fileType: 'pdf' },
    }));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(expect.stringContaining('queued for background processing'));

    add(result, [file('lecture.mp4', 'video', 'video/mp4')]);
    await act(async () => result.current.handleUpload('course-1', 'private', 'term-1'));
    expect(mocks.uploadVideo).toHaveBeenCalledWith(expect.objectContaining({
      courseId: 'course-1', academicTermId: 'term-1', accessScope: 'private', uploaderId: 'user-1',
    }));
  });

  it('retains failed files for retry and summarizes mixed outcomes', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: { error: 'OCR failed' }, error: null });
    const result = setup();
    const good = file('good.txt', 'good', 'text/plain');
    const bad = file('bad.pdf');
    add(result, [good, bad]);
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    expect(result.current.pendingFiles).toEqual([bad]);
    expect(mocks.toastError).toHaveBeenCalledWith('bad.pdf: OCR failed');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('1 material uploaded');
    expect(mocks.toastError).toHaveBeenCalledWith('1 material failed. Remove or retry.');
  });

  it('validates required upload context and resets or removes queued selections', async () => {
    const result = setup(null as unknown as undefined);
    add(result, [file('notes.txt', 'notes', 'text/plain')]);
    await act(async () => result.current.handleUpload('course', 'course', 'term'));
    expect(mocks.toastError).toHaveBeenCalledWith('Profile not loaded');
    expect(mocks.uploadStorage).not.toHaveBeenCalled();

    const key = result.current.getPendingFileKey(result.current.pendingFiles[0]);
    act(() => result.current.removePendingFile(key));
    expect(result.current.pendingFiles).toEqual([]);
    add(result, [file('again.txt', 'notes', 'text/plain')]);
    act(() => result.current.handleCancelUpload());
    expect(result.current.pendingFiles).toEqual([]);
  });
});
