import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), invoke: vi.fn(),
  previousUploads: [] as Array<Record<string, unknown>>,
  uploads: [] as Array<{ options: Record<string, unknown>; start: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn>; findPreviousUploads: ReturnType<typeof vi.fn>; resumeFromPreviousUpload: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: mocks.getSession }, functions: { invoke: mocks.invoke } },
}));
vi.mock('tus-js-client', () => ({
  Upload: class {
    constructor(_file: File, options: Record<string, unknown>) {
      const upload = {
        options, start: vi.fn(), abort: vi.fn().mockResolvedValue(undefined),
        findPreviousUploads: vi.fn().mockImplementation(async () => mocks.previousUploads), resumeFromPreviousUpload: vi.fn(),
      };
      mocks.uploads.push(upload);
      return upload;
    }
  },
}));

const makeFile = (size = 10) => {
  const file = new File(['video'], 'lecture.mp4', { type: 'video/mp4', lastModified: 123 });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

async function run(overrides: Record<string, unknown> = {}) {
  const { uploadVideoForTranscription } = await import('./videoUploadPipeline');
  return uploadVideoForTranscription({
    file: makeFile(), courseId: 'course-1', academicTermId: 'term-1',
    accessScope: 'course', uploaderId: 'user-1', onProgress: vi.fn(), ...overrides,
  });
}

describe('uploadVideoForTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploads.length = 0;
    mocks.previousUploads = [];
    localStorage.clear();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001') });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'access-token' } } });
    mocks.invoke.mockImplementation(async (_name, { body }) => body.action === 'create'
      ? { data: { materialId: 'material-1', filePath: 'course-1/material-1-lecture.mp4', uploaded: false }, error: null }
      : { data: { materialId: 'material-1', uploaded: true, transcriptionStatus: 'pending' }, error: null });
  });

  it('creates a stable session, uploads with TUS and actual byte progress, then completes', async () => {
    const onProgress = vi.fn();
    const promise = run({ onProgress });
    await vi.waitFor(() => expect(mocks.uploads).toHaveLength(1));
    const upload = mocks.uploads[0];
    expect(mocks.invoke).toHaveBeenCalledWith('video-upload-session', expect.objectContaining({
      body: expect.objectContaining({ action: 'create', courseId: 'course-1', fileSize: 10, uploadKey: '00000000-0000-4000-8000-000000000001' }),
    }));
    expect(upload.options).toEqual(expect.objectContaining({
      endpoint: expect.stringContaining('/storage/v1/upload/resumable'),
      chunkSize: 6 * 1024 * 1024, removeFingerprintOnSuccess: true,
      metadata: expect.objectContaining({ bucketName: 'course-materials', objectName: 'course-1/material-1-lecture.mp4' }),
    }));
    expect(upload.options.headers).not.toHaveProperty('x-upsert');
    (upload.options.onProgress as (sent: number, total: number) => void)(5, 10);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'uploading', progress: 50, bytesUploaded: 5, bytesTotal: 10 }));
    (upload.options.onSuccess as () => void)();
    await expect(promise).resolves.toEqual({ materialId: 'material-1', transcriptionStatus: 'pending' });
    expect(mocks.invoke).toHaveBeenLastCalledWith('video-upload-session', expect.objectContaining({ body: { action: 'complete', materialId: 'material-1' } }));
    expect(localStorage.length).toBe(0);
  });

  it('reuses the upload key on retry and resumes a prior TUS URL', async () => {
    const first = run();
    await vi.waitFor(() => expect(mocks.uploads).toHaveLength(1));
    (mocks.uploads[0].options.onError as (error: Error) => void)(new Error('network down'));
    await expect(first).rejects.toThrow('network down');
    const previous = { uploadUrl: 'https://upload.test/old', urlStorageKey: 'old-key', creationTime: new Date().toISOString(), metadata: { bucketName: 'course-materials', objectName: 'course-1/material-1-lecture.mp4' } };
    mocks.previousUploads = [previous];
    const second = run();
    await vi.waitFor(() => expect(mocks.uploads).toHaveLength(2));
    const upload = mocks.uploads[1];
    await vi.waitFor(() => expect(upload.resumeFromPreviousUpload).toHaveBeenCalledWith(previous));
    (upload.options.onSuccess as () => void)();
    await expect(second).resolves.toEqual({ materialId: 'material-1', transcriptionStatus: 'pending' });
    const creates = mocks.invoke.mock.calls.filter(([, options]) => options.body.action === 'create');
    expect(creates[0][1].body.uploadKey).toBe(creates[1][1].body.uploadKey);
  });

  it('skips transfer when the server verifies the object already exists', async () => {
    mocks.invoke.mockImplementation(async (_name, { body }) => body.action === 'create'
      ? { data: { materialId: 'material-1', filePath: 'course-1/material-1-lecture.mp4', uploaded: true }, error: null }
      : { data: { materialId: 'material-1', uploaded: true, transcriptionStatus: 'pending' }, error: null });
    await expect(run()).resolves.toEqual({ materialId: 'material-1', transcriptionStatus: 'pending' });
    expect(mocks.uploads).toHaveLength(0);
  });

  it('starts fresh when a stored TUS URL is near expiry', async () => {
    mocks.previousUploads = [{
      uploadUrl: 'https://upload.test/stale', urlStorageKey: 'old-key',
      creationTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      metadata: { bucketName: 'course-materials', objectName: 'course-1/material-1-lecture.mp4' },
    }];
    const promise = run();
    await vi.waitFor(() => expect(mocks.uploads).toHaveLength(1));
    const upload = mocks.uploads[0];
    await vi.waitFor(() => expect(upload.start).toHaveBeenCalled());
    expect(upload.resumeFromPreviousUpload).not.toHaveBeenCalled();
    (upload.options.onSuccess as () => void)();
    await promise;
  });

  it('restarts a resumed transfer if its server URL has expired', async () => {
    mocks.previousUploads = [{
      uploadUrl: 'https://upload.test/expired', urlStorageKey: 'old-key',
      creationTime: new Date().toISOString(),
      metadata: { bucketName: 'course-materials', objectName: 'course-1/material-1-lecture.mp4' },
    }];
    const promise = run();
    await vi.waitFor(() => expect(mocks.uploads).toHaveLength(1));
    const upload = mocks.uploads[0];
    await vi.waitFor(() => expect(upload.resumeFromPreviousUpload).toHaveBeenCalled());
    (upload.options.onError as (error: Error) => void)(Object.assign(new Error('expired'), {
      originalResponse: { getStatus: () => 410 },
    }));
    await vi.waitFor(() => expect(upload.start).toHaveBeenCalledTimes(2));
    (upload.options.onSuccess as () => void)();
    await promise;
  });

  it('uses a fresh session for each TUS request', async () => {
    const promise = run();
    await vi.waitFor(() => expect(mocks.uploads).toHaveLength(1));
    const before = mocks.uploads[0].options.onBeforeRequest as (req: { setHeader: ReturnType<typeof vi.fn> }) => Promise<void>;
    const req = { setHeader: vi.fn() };
    await before(req);
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'refreshed-token' } } });
    await before(req);
    expect(req.setHeader).toHaveBeenCalledWith('authorization', 'Bearer refreshed-token');
    (mocks.uploads[0].options.onSuccess as () => void)();
    await promise;
  });

  it('reports a saved video with failed transcription without claiming it is processing', async () => {
    mocks.invoke.mockImplementation(async (_name, { body }) => body.action === 'create'
      ? { data: { materialId: 'material-1', filePath: 'course-1/material-1-lecture.mp4', uploaded: true }, error: null }
      : { data: { materialId: 'material-1', uploaded: true, transcriptionStatus: 'failed' }, error: null });
    const onProgress = vi.fn();
    await expect(run({ onProgress })).resolves.toEqual({ materialId: 'material-1', transcriptionStatus: 'failed' });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'error', statusText: expect.stringContaining('Transcription failed') }));
    expect(localStorage.length).toBe(0);
  });

  it('enforces 3 GB before server work and aborts an in-flight transfer', async () => {
    await expect(run({ file: makeFile(3_000_000_001) })).rejects.toThrow('3 GB');
    expect(mocks.invoke).not.toHaveBeenCalled();
    const controller = new AbortController();
    const promise = run({ signal: controller.signal });
    await vi.waitFor(() => expect(mocks.uploads).toHaveLength(1));
    controller.abort();
    await expect(promise).rejects.toThrow('Upload cancelled');
    expect(mocks.uploads[0].abort).toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.some(([, options]) => options.body.action === 'complete')).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith('video-upload-session', { body: { action: 'cancel', materialId: 'material-1' } });
    expect(localStorage.length).toBe(0);
  });
});
