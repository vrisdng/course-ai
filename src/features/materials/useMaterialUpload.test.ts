import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), uploadStorage: vi.fn(), uploadVideo: vi.fn(), invoke: vi.fn(), from: vi.fn(),
  storageFrom: vi.fn(), removeStorage: vi.fn(), cleanupFrom: vi.fn(), cleanupDelete: vi.fn(), cleanupEq: vi.fn(),
  lookupSelect: vi.fn(), lookupEq: vi.fn(), lookupMaybeSingle: vi.fn(),
  toastError: vi.fn(), toastSuccess: vi.fn(), toastInfo: vi.fn(),
}));
vi.mock('@supabase/supabase-js', async (importOriginal) => ({ ...(await importOriginal()), createClient: mocks.createClient }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: { from: mocks.storageFrom },
    from: mocks.cleanupFrom,
  },
}));
vi.mock('@/lib/uploadWithProgress', () => ({ uploadToStorageWithProgress: mocks.uploadStorage }));
vi.mock('@/lib/videoUploadPipeline', () => ({ uploadVideoForTranscription: mocks.uploadVideo }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess, info: mocks.toastInfo } }));

import { ACCEPTED_FILE_TYPES, useMaterialUpload } from './useMaterialUpload';
import type { UploadPolicy } from '../../../supabase/functions/_shared/uploadPolicy.ts';

const ONLY_MESSAGE = 'Only PDF documents and MP4 or WebM videos are accepted.';
const TEXT_ENABLED: UploadPolicy = { enabledFamilies: ['pdf', 'video', 'text'] };
const OFFICE_ENABLED: UploadPolicy = { enabledFamilies: ['pdf', 'video', 'office'] };
const httpError = (status: number, body: unknown) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
});

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
    mocks.removeStorage.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({ remove: mocks.removeStorage });
    mocks.cleanupEq.mockResolvedValue({ error: null });
    mocks.cleanupDelete.mockReturnValue({ eq: mocks.cleanupEq });
    mocks.lookupMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.lookupEq.mockReturnValue({ maybeSingle: mocks.lookupMaybeSingle });
    mocks.lookupSelect.mockReturnValue({ eq: mocks.lookupEq });
    mocks.cleanupFrom.mockReturnValue({ delete: mocks.cleanupDelete, select: mocks.lookupSelect });
    onUploaded.mockResolvedValue(undefined);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid') });
    localStorage.clear();
  });
  const setup = (uploaderId: string | undefined = 'user-1', uploadPolicy?: UploadPolicy) =>
    renderHook(() => useMaterialUpload({ uploaderId, onUploaded, uploadPolicy })).result;
  const add = (result: ReturnType<typeof setup>, files: File[], error: string | null = null) =>
    act(() => result.current.handleFileInputChange({ target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>, error));

  it('queues supported unique files and reports unsupported, oversized, and duplicate choices', () => {
    const result = setup();
    const pdf = file('notes.pdf');
    add(result, [pdf, pdf, file('virus.exe')]);
    expect(result.current.pendingFiles).toEqual([pdf]);
    expect(mocks.toastError).toHaveBeenCalledWith(`"virus.exe" can't be uploaded. ${ONLY_MESSAGE}`);
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

  it('accepts a video whose browser type is unknown and hands it to the video pipeline', async () => {
    const result = setup();
    const video = file('lecture.mp4', 'video', '');
    add(result, [video]);
    expect(result.current.pendingFiles).toEqual([video]);
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    expect(mocks.uploadVideo).toHaveBeenCalledWith(expect.objectContaining({ file: video }));
  });

  it('restricts the file chooser to PDF and video', () => {
    expect(ACCEPTED_FILE_TYPES).toBe('.pdf,application/pdf,.mp4,video/mp4,.webm,video/webm');
  });

  it('turns away Office, image, text and mislabelled files at selection with a visible reason', () => {
    const result = setup();
    const pdf = file('notes.pdf', '%PDF', 'application/pdf');
    const video = file('lecture.webm', 'video', 'video/webm');
    add(result, [
      pdf,
      video,
      file('slides.pptx', 'x', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      file('notes.docx', 'x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      file('photo.png', 'x', 'image/png'),
      file('lesson.txt', 'x', 'text/plain'),
      file('renamed.pdf', 'x', 'video/mp4'),
    ]);
    expect(result.current.pendingFiles).toEqual([pdf, video]);
    expect(result.current.rejectedUploads.map((item) => item.fileName)).toEqual([
      'slides.pptx', 'notes.docx', 'photo.png', 'lesson.txt', 'renamed.pdf',
    ]);
    expect(result.current.rejectedUploads[0].message).toBe(`"slides.pptx" can't be uploaded. ${ONLY_MESSAGE}`);
    expect(result.current.rejectedUploads[4].message).toContain("doesn't match the .pdf extension");
    expect(mocks.toastError).toHaveBeenCalledWith(`Skipped 5 files that can't be uploaded. ${ONLY_MESSAGE}`);

    add(result, [file('more.pdf')]);
    expect(result.current.rejectedUploads).toEqual([]);
    add(result, [file('again.pptx')]);
    act(() => result.current.dismissRejectedUploads());
    expect(result.current.rejectedUploads).toEqual([]);
  });

  it('shows the server admission error and drops the file instead of offering a retry', async () => {
    const message = `"slides.pdf" can't be uploaded: its contents aren't a valid PDF file. ${ONLY_MESSAGE}`;
    mocks.invoke.mockResolvedValueOnce({ data: null, error: httpError(415, { error: message, code: 'content_mismatch' }) });
    const result = setup();
    add(result, [file('slides.pdf')]);
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    expect(mocks.toastError).toHaveBeenCalledWith(message);
    expect(result.current.pendingFiles).toEqual([]);
    expect(result.current.rejectedUploads).toEqual([{ fileName: 'slides.pdf', message }]);
    expect(mocks.toastError).not.toHaveBeenCalledWith(expect.stringContaining('Remove or retry'));
  });

  it('surfaces other server error bodies instead of the generic non-2xx text', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: httpError(500, { error: 'Failed to enqueue parse job' }) });
    const result = setup();
    const pdf = file('slides.pdf');
    add(result, [pdf]);
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    expect(mocks.toastError).toHaveBeenCalledWith('slides.pdf: Failed to enqueue parse job');
    expect(result.current.pendingFiles).toEqual([pdf]);
  });

  it('retries a document whose parse response was lost with the same material and object', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: null, error: httpError(500, { error: 'Gateway timeout' }) })
      .mockResolvedValueOnce({ data: { queued: true }, error: null });
    const result = setup();
    const pdf = file('slides.pdf');
    add(result, [pdf]);

    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));

    expect(mocks.uploadStorage).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'parse-document', expect.objectContaining({
      body: { materialId: 'material-1', filePath: 'course-1/uuid-slides.pdf', fileType: 'pdf' },
    }));
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'parse-document', expect.objectContaining({
      body: { materialId: 'material-1', filePath: 'course-1/uuid-slides.pdf', fileType: 'pdf' },
    }));
  });

  it('retries a failed parse enqueue without creating another document', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { error: 'Failed to enqueue parse job' }, error: null })
      .mockResolvedValueOnce({ data: { queued: true }, error: null });
    const result = setup();
    const pdf = file('slides.pdf');
    add(result, [pdf]);

    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));

    expect(mocks.uploadStorage).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenLastCalledWith('parse-document', expect.objectContaining({
      body: { materialId: 'material-1', filePath: 'course-1/uuid-slides.pdf', fileType: 'pdf' },
    }));
  });

  it('removes the stored object when cancellation wins after storage but before material creation', async () => {
    const result = setup();
    let resolveStorage!: () => void;
    mocks.uploadStorage.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveStorage = resolve;
    }));
    add(result, [file('slides.pdf')]);
    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.handleUpload('course-1', 'course', 'term-1');
    });
    await waitFor(() => expect(result.current.isUploading).toBe(true));
    act(() => result.current.handleCancelUpload());
    resolveStorage();

    await act(async () => { await uploadPromise; });

    expect(db.insert).not.toHaveBeenCalled();
    expect(mocks.removeStorage).toHaveBeenCalledWith(['course-1/uuid-slides.pdf']);
  });

  it('removes the stored object after a confirmed material insert failure', async () => {
    db = insertChain({ data: null, error: { code: '42501', message: 'Not allowed' } });
    mocks.from.mockReturnValue(db);
    const result = setup();
    add(result, [file('slides.pdf')]);

    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));

    expect(mocks.removeStorage).toHaveBeenCalledWith(['course-1/uuid-slides.pdf']);
    expect(result.current.pendingFiles).toHaveLength(1);
  });

  it('removes the material and object when cancellation wins after the material insert', async () => {
    const result = setup();
    let resolveInsert!: (result: { data: { id: string }; error: null }) => void;
    db.single.mockImplementationOnce(() => new Promise((resolve) => { resolveInsert = resolve; }));
    add(result, [file('slides.pdf')]);
    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.handleUpload('course-1', 'course', 'term-1');
    });
    await waitFor(() => expect(db.single).toHaveBeenCalled());
    act(() => result.current.handleCancelUpload());
    resolveInsert({ data: { id: 'material-1' }, error: null });

    await act(async () => { await uploadPromise; });

    expect(mocks.removeStorage).toHaveBeenCalledWith(['course-1/uuid-slides.pdf']);
    expect(mocks.cleanupDelete).toHaveBeenCalled();
    expect(mocks.cleanupEq).toHaveBeenCalledWith('id', 'material-1');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('routes DOCX/PPTX through parse-document again when the policy enables Office', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { queued: true }, error: null });
    const result = setup('user-1', OFFICE_ENABLED);
    add(result, [file('deck.pptx')]);
    expect(result.current.rejectedUploads).toEqual([]);
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    expect(mocks.uploadStorage).toHaveBeenCalledWith(expect.objectContaining({
      path: 'course-1/uuid-deck.pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }));
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ file_type: 'slides' }));
    expect(mocks.invoke).toHaveBeenCalledWith('parse-document', expect.objectContaining({
      body: { materialId: 'material-1', filePath: 'course-1/uuid-deck.pptx', fileType: 'pptx' },
    }));
  });

  it('uploads and directly ingests text with correct metadata and progress when text is enabled', async () => {
    const result = setup('user-1', TEXT_ENABLED);
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
    expect(mocks.uploadStorage).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'application/pdf' }));
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

  it('keeps a saved video visible and reports a transcription failure without a queued success toast', async () => {
    mocks.uploadVideo.mockResolvedValueOnce({ materialId: 'video-1', transcriptionStatus: 'failed' });
    const result = setup();
    add(result, [file('lecture.mp4', 'video', 'video/mp4')]);
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    expect(onUploaded).toHaveBeenCalled();
    expect(result.current.pendingFiles).toEqual([]);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('Video saved; transcription failed'));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('sanitises the storage key for names with disallowed characters but keeps the original display name', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { queued: true }, error: null });
    const result = setup();
    const tilde = file('~CE5010QB Ch1 Slides.pdf');
    add(result, [tilde]);
    expect(result.current.pendingFiles).toEqual([tilde]);
    expect(mocks.toastError).not.toHaveBeenCalled();
    await act(async () => result.current.handleUpload('course-1', 'course', 'term-1'));
    expect(mocks.uploadStorage).toHaveBeenCalledWith(expect.objectContaining({
      path: 'course-1/uuid-CE5010QB Ch1 Slides.pdf',
    }));
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      file_name: '~CE5010QB Ch1 Slides.pdf', file_path: 'course-1/uuid-CE5010QB Ch1 Slides.pdf', file_type: 'pdf',
    }));
    expect(mocks.invoke).toHaveBeenCalledWith('parse-document', expect.objectContaining({
      body: { materialId: 'material-1', filePath: 'course-1/uuid-CE5010QB Ch1 Slides.pdf', fileType: 'pdf' },
    }));
  });

  it('retains failed files for retry and summarizes mixed outcomes', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: { error: 'OCR failed' }, error: null });
    const result = setup();
    const good = file('good.pdf', '%PDF', 'application/pdf');
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
    add(result, [file('notes.pdf', '%PDF', 'application/pdf')]);
    await act(async () => result.current.handleUpload('course', 'course', 'term'));
    expect(mocks.toastError).toHaveBeenCalledWith('Profile not loaded');
    expect(mocks.uploadStorage).not.toHaveBeenCalled();

    const key = result.current.getPendingFileKey(result.current.pendingFiles[0]);
    act(() => result.current.removePendingFile(key));
    expect(result.current.pendingFiles).toEqual([]);
    add(result, [file('again.pdf', '%PDF', 'application/pdf')]);
    act(() => result.current.handleCancelUpload());
    expect(result.current.pendingFiles).toEqual([]);
  });
});
