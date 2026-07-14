import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const invoke = vi.fn();
const single = vi.fn();
const select = vi.fn(() => ({ single }));
const insert = vi.fn(() => ({ select }));
const from = vi.fn(() => ({ insert }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession }, functions: { invoke }, from },
}));

describe('uploadVideoForTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 17));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    getSession.mockResolvedValue({ data: { session: { access_token: 'access-token' } } });
    single.mockResolvedValue({ data: { id: 'material-1' }, error: null });
    invoke.mockResolvedValue({ data: { accepted: true }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ uploadUrl: 'https://assembly.test/audio' }),
    }));
  });

  async function run(overrides: Record<string, unknown> = {}) {
    const { uploadVideoForTranscription } = await import('./videoUploadPipeline');
    return uploadVideoForTranscription({
      file: new File(['video'], 'lecture.mp4', { type: 'video/mp4' }),
      courseId: 'course-1', academicTermId: 'term-1', accessScope: 'course', uploaderId: 'user-1',
      onProgress: vi.fn(), ...overrides,
    });
  }

  it('uploads, persists metadata, starts transcription, and reports progress', async () => {
    const onProgress = vi.fn();
    await expect(run({ accessScope: 'public', onProgress })).resolves.toEqual({ materialId: 'material-1' });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/functions/v1/upload-video'), expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer access-token', 'Content-Type': 'video/mp4' }),
    }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      course_id: 'course-1', academic_term_id: 'term-1', access_scope: 'public', is_public: true,
      uploaded_by: 'user-1', file_name: 'lecture.mp4', file_type: 'video', processing_status: 'pending',
    }));
    expect(invoke).toHaveBeenCalledWith('transcribe-video', { body: { materialId: 'material-1', audioUrl: 'https://assembly.test/audio' } });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'uploading', progress: 90 }));
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'parsing', progress: 95 }));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });

  it('rejects unauthenticated and unsuccessful proxy uploads without creating records', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(run()).rejects.toThrow('Not authenticated');
    expect(from).not.toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 413, json: vi.fn().mockResolvedValue({ error: 'Video too large' }) } as unknown as Response);
    await expect(run()).rejects.toThrow('Video too large');
    expect(from).not.toHaveBeenCalled();
  });

  it('handles malformed success responses and material persistence failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) } as unknown as Response);
    await expect(run()).rejects.toThrow('No upload URL');

    single.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } });
    await expect(run()).rejects.toThrow('Failed to create material record: database unavailable');
  });

  it('surfaces edge-function transport and application errors', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    await expect(run()).rejects.toThrow('Transcription failed: timeout');
    invoke.mockResolvedValueOnce({ data: { error: 'Unsupported media' }, error: null });
    await expect(run()).rejects.toThrow('Unsupported media');
  });

  it('honors cancellation before network work begins', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(run({ signal: controller.signal })).rejects.toThrow('Upload cancelled');
    expect(getSession).not.toHaveBeenCalled();
  });
});
