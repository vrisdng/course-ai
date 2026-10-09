import { beforeEach, describe, expect, it, vi } from 'vitest';

import { R2_MAX_OBJECT_BYTES } from './videoUploadLimits';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  send: vi.fn(),
  clients: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(config: Record<string, unknown>) { mocks.clients.push(config); }
    send(command: unknown, options?: unknown) { return mocks.send(command, options); }
  },
  UploadPartCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) { this.input = input; }
  },
}));

const credentials = {
  endpoint: 'https://account.r2.cloudflarestorage.com', region: 'auto', bucket: 'videos-dev',
  accessKeyId: 'temporary-key', secretAccessKey: 'temporary-secret', sessionToken: 'temporary-token',
  expiresAt: '2026-10-08T12:00:00.000Z',
};
const created = {
  materialId: 'material-1', filePath: 'videos/material-1/source.mp4', r2UploadId: 'upload-1',
  partSize: 5, credentials, uploaded: false,
};

const makeFile = (size = 10) => {
  const file = new File(['0123456789'], 'lecture.mp4', { type: 'video/mp4', lastModified: 123 });
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
    mocks.clients.length = 0;
    localStorage.clear();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001') });
    mocks.send.mockResolvedValue({ ETag: '"etag"' });
    mocks.invoke.mockImplementation(async (_name, { body }) => {
      if (body.action === 'create-multipart') return { data: created, error: null };
      if (body.action === 'list-parts') return { data: { materialId: created.materialId, r2UploadId: created.r2UploadId, parts: [] }, error: null };
      if (body.action === 'complete-multipart') return { data: { materialId: created.materialId, uploaded: true, transcriptionStatus: 'pending' }, error: null };
      if (body.action === 'abort-multipart') return { data: { materialId: created.materialId, aborted: true }, error: null };
      return { data: null, error: new Error('Unexpected action') };
    });
  });

  it('creates an R2 session, uploads missing parts, then completes', async () => {
    const onProgress = vi.fn();
    await expect(run({ onProgress })).resolves.toEqual({ materialId: 'material-1', transcriptionStatus: 'pending' });

    expect(mocks.invoke).toHaveBeenCalledWith('video-upload-session', expect.objectContaining({
      body: expect.objectContaining({ action: 'create-multipart', fileSize: 10, uploadKey: '00000000-0000-4000-8000-000000000001' }),
    }));
    expect(mocks.invoke).toHaveBeenCalledWith('video-upload-session', expect.objectContaining({ body: { action: 'list-parts', materialId: 'material-1' } }));
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls.map(([command]) => command.input.PartNumber)).toEqual([1, 2]);
    expect(mocks.clients[0]).toEqual(expect.objectContaining({
      endpoint: credentials.endpoint,
      credentials: expect.objectContaining({ sessionToken: credentials.sessionToken }),
    }));
    expect(mocks.invoke).toHaveBeenLastCalledWith('video-upload-session', expect.objectContaining({ body: { action: 'complete-multipart', materialId: 'material-1' } }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ progress: 100, bytesUploaded: 10, bytesTotal: 10 }));
    expect(localStorage.length).toBe(0);
  });

  it('resumes from R2 server state and skips accepted parts', async () => {
    mocks.invoke.mockImplementation(async (_name, { body }) => {
      if (body.action === 'create-multipart') return { data: created, error: null };
      if (body.action === 'list-parts') return { data: { materialId: created.materialId, r2UploadId: created.r2UploadId, parts: [{ partNumber: 1, etag: '"one"', size: 5 }] }, error: null };
      return { data: { materialId: created.materialId, uploaded: true, transcriptionStatus: 'pending' }, error: null };
    });
    await run();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].input.PartNumber).toBe(2);
  });

  it('refreshes expired credentials without creating another material or upload', async () => {
    const expired = Object.assign(new Error('expired'), { name: 'ExpiredToken', $metadata: { httpStatusCode: 403 } });
    mocks.send.mockRejectedValueOnce(expired).mockResolvedValue({ ETag: '"etag"' });
    await run();
    const creates = mocks.invoke.mock.calls.filter(([, options]) => options.body.action === 'create-multipart');
    expect(creates).toHaveLength(2);
    expect(creates[0][1].body.uploadKey).toBe(creates[1][1].body.uploadKey);
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it('returns immediately when the idempotent session is already uploaded', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { materialId: 'material-1', filePath: created.filePath, uploaded: true, transcriptionStatus: 'completed' },
      error: null,
    });
    await expect(run()).resolves.toEqual({ materialId: 'material-1', transcriptionStatus: 'completed' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('aborts the multipart session when the user cancels', async () => {
    const controller = new AbortController();
    mocks.send.mockImplementation((_command, options) => new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }));
    const promise = run({ signal: controller.signal });
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalled());
    controller.abort();
    await expect(promise).rejects.toThrow('Upload cancelled');
    expect(mocks.invoke).toHaveBeenCalledWith('video-upload-session', { body: { action: 'abort-multipart', materialId: 'material-1' } });
    expect(mocks.invoke.mock.calls.some(([, options]) => options.body.action === 'complete-multipart')).toBe(false);
  });

  it('keeps the upload key after a part upload failure', async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error('upload rejected'), { $metadata: { httpStatusCode: 400 } }));
    await expect(run()).rejects.toThrow('upload rejected');
    expect(localStorage.length).toBe(1);
    expect(mocks.invoke.mock.calls.some(([, options]) => options.body.action === 'abort-multipart')).toBe(false);
  });

  it('rejects a file above the R2 ceiling before server work', async () => {
    await expect(run({ file: makeFile(R2_MAX_OBJECT_BYTES + 1) })).rejects.toThrow('5 TB');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
