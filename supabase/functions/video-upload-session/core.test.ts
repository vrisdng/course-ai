import { describe, expect, it, vi } from 'vitest';
import { handleUploadSession, reapVideoUploads, type UploadMaterial, type UploadSessionStore } from './core';

const USER = { userId: '11111111-1111-4111-8111-111111111111', profileId: '22222222-2222-4222-8222-222222222222' };
const COURSE = '33333333-3333-4333-8333-333333333333';
const TERM = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const ID = '66666666-6666-4666-8666-666666666666';
const createBody = { action: 'create', courseId: COURSE, academicTermId: TERM, accessScope: 'course', fileName: 'lecture.mp4', fileSize: 3_000_000_000, contentType: 'video/mp4', uploadKey: KEY };

function material(overrides: Partial<UploadMaterial> = {}): UploadMaterial {
  return { id: ID, course_id: COURSE, academic_term_id: TERM, access_scope: 'course', uploaded_by: USER.profileId, file_name: 'lecture.mp4', file_size: 3_000_000_000, file_type: 'video', file_path: `videos/${USER.userId}/${ID}.mp4`, video_content_type: 'video/mp4', video_upload_key: KEY, video_upload_state: 'uploading', ...overrides };
}

function store(overrides: Partial<UploadSessionStore> = {}): UploadSessionStore {
  return {
    courseExists: vi.fn().mockResolvedValue(true), termExists: vi.fn().mockResolvedValue(true),
    findByKey: vi.fn().mockResolvedValue(null), findMaterial: vi.fn().mockResolvedValue(material()),
    createMaterial: vi.fn().mockResolvedValue(material()),
    objectInfo: vi.fn().mockResolvedValue(null), markUploaded: vi.fn().mockResolvedValue(undefined),
    markCancelled: vi.fn().mockResolvedValue(undefined), removeObject: vi.fn().mockResolvedValue(undefined),
    markDeleting: vi.fn().mockResolvedValue(undefined), deleteMaterial: vi.fn().mockResolvedValue(undefined),
    deleteMaterialByPath: vi.fn().mockResolvedValue(undefined),
    recordCleanup: vi.fn().mockResolvedValue(undefined),
    staleUploads: vi.fn().mockResolvedValue([]), dueCleanup: vi.fn().mockResolvedValue([]),
    deferCleanup: vi.fn().mockResolvedValue(undefined), finishCleanup: vi.fn().mockResolvedValue(undefined),
    enqueueTranscription: vi.fn().mockResolvedValue({ status: 'pending' }),
    transcriptionStatus: vi.fn().mockResolvedValue('pending'), ...overrides,
  };
}

describe('video upload session', () => {
  it('creates an owned private path and accepts exactly 3 GB', async () => {
    const db = store();
    const response = await handleUploadSession(createBody, USER, db, () => ID);
    expect(response).toEqual({ status: 200, body: { materialId: ID, filePath: `videos/${USER.userId}/${ID}.mp4`, uploaded: false } });
    expect(db.createMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: ID, uploaded_by: USER.profileId, file_size: 3_000_000_000, file_path: `videos/${USER.userId}/${ID}.mp4`, processing_status: 'pending' }));
  });

  it.each([0, -1, 3_000_000_001, 1.5, NaN])('rejects invalid size %s', async (fileSize) => {
    const db = store();
    expect((await handleUploadSession({ ...createBody, fileSize }, USER, db)).status).toBe(400);
    expect(db.createMaterial).not.toHaveBeenCalled();
  });

  it('rejects mismatched idempotency key reuse', async () => {
    const db = store({ findByKey: vi.fn().mockResolvedValue(material({ file_size: 42 })) });
    const response = await handleUploadSession(createBody, USER, db);
    expect(response.status).toBe(409);
    expect(db.createMaterial).not.toHaveBeenCalled();
  });

  it('rejects reuse of a deleting upload key', async () => {
    const db = store({ findByKey: vi.fn().mockResolvedValue(material({ video_upload_state: 'deleting' })) });
    expect((await handleUploadSession(createBody, USER, db)).status).toBe(409);
  });

  it('returns existing upload and verifies object size before reporting uploaded', async () => {
    const db = store({ findByKey: vi.fn().mockResolvedValue(material()), objectInfo: vi.fn().mockResolvedValue({ size: 3_000_000_000, contentType: 'video/mp4' }) });
    const response = await handleUploadSession(createBody, USER, db);
    expect(response.body).toEqual({ materialId: ID, filePath: material().file_path, uploaded: true });
    expect(db.createMaterial).not.toHaveBeenCalled();
  });

  it('does not complete a missing or wrong-size object', async () => {
    const db = store({ objectInfo: vi.fn().mockResolvedValue({ size: 100, contentType: 'video/mp4' }) });
    const response = await handleUploadSession({ action: 'complete', materialId: ID }, USER, db);
    expect(response.status).toBe(409);
    expect(db.markUploaded).not.toHaveBeenCalled();
    expect(db.enqueueTranscription).not.toHaveBeenCalled();
  });

  it('prevents a different admin from completing another uploader’s video', async () => {
    const db = store({ findMaterial: vi.fn().mockResolvedValue(material({ uploaded_by: 'other-profile' })) });
    const response = await handleUploadSession({ action: 'complete', materialId: ID }, USER, db);
    expect(response.status).toBe(404);
    expect(db.objectInfo).not.toHaveBeenCalled();
  });

  it('completes verified upload and retries enqueue without changing identity', async () => {
    const db = store({ objectInfo: vi.fn().mockResolvedValue({ size: 3_000_000_000, contentType: 'video/mp4' }) });
    const body = { action: 'complete', materialId: ID };
    expect((await handleUploadSession(body, USER, db)).status).toBe(200);
    expect((await handleUploadSession(body, USER, db)).status).toBe(200);
    expect(db.markUploaded).toHaveBeenCalledTimes(2);
    expect(db.enqueueTranscription).toHaveBeenCalledTimes(2);
  });

  it('reports stored upload success when transcription submission fails', async () => {
    const db = store({
      objectInfo: vi.fn().mockResolvedValue({ size: 3_000_000_000, contentType: 'video/mp4' }),
      enqueueTranscription: vi.fn().mockRejectedValue(new Error('Provider rejected job')),
      transcriptionStatus: vi.fn().mockResolvedValue('failed'),
    });
    const response = await handleUploadSession({ action: 'complete', materialId: ID }, USER, db);
    expect(response).toEqual({ status: 200, body: { materialId: ID, filePath: material().file_path, uploaded: true, transcriptionStatus: 'failed' } });
  });

  it('cancels an incomplete upload and keeps a cleanup record for late TUS completion', async () => {
    const db = store({ markCancelled: vi.fn().mockResolvedValue(undefined), removeObject: vi.fn().mockResolvedValue(undefined) });
    const response = await handleUploadSession({ action: 'cancel', materialId: ID }, USER, db);
    expect(response.status).toBe(200);
    expect(db.markCancelled).toHaveBeenCalledWith(ID);
    expect(db.recordCleanup).toHaveBeenCalledWith(material().file_path);
    expect(db.removeObject).toHaveBeenCalledWith(material().file_path);
    expect(db.deleteMaterial).toHaveBeenCalledWith(ID);
  });

  it('will not cancel an already completed upload', async () => {
    const db = store({ findMaterial: vi.fn().mockResolvedValue(material({ video_upload_state: 'uploaded' })) });
    expect((await handleUploadSession({ action: 'cancel', materialId: ID }, USER, db)).status).toBe(409);
    expect(db.markCancelled).not.toHaveBeenCalled();
  });

  it('makes retrying cancellation after row deletion safe', async () => {
    const db = store({ findMaterial: vi.fn().mockResolvedValue(null) });
    expect((await handleUploadSession({ action: 'cancel', materialId: ID }, USER, db)).body)
      .toEqual({ materialId: ID, cancelled: true });
  });

  it('deletes stored video only after durable cleanup intent and object removal', async () => {
    const db = store({ findMaterial: vi.fn().mockResolvedValue(material({ video_upload_state: 'uploaded' })) });
    const response = await handleUploadSession({ action: 'delete', materialId: ID }, USER, db);
    expect(response.body).toEqual({ materialId: ID, deleted: true });
    expect(vi.mocked(db.recordCleanup).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(db.markDeleting).mock.invocationCallOrder[0]);
    expect(vi.mocked(db.removeObject).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(db.deleteMaterial).mock.invocationCallOrder[0]);
  });

  it('reaps at most 25 abandoned uploads and 25 due cleanup paths', async () => {
    const now = new Date('2026-10-06T00:00:00Z');
    const db = store({
      staleUploads: vi.fn().mockResolvedValue([material()]),
      dueCleanup: vi.fn().mockResolvedValue([{ file_path: 'videos/old.mp4', created_at: '2026-09-01T00:00:00Z' }]),
    });
    expect(await reapVideoUploads(db, now)).toEqual({ abandoned: 1, cleaned: 1, errors: 0 });
    expect(db.staleUploads).toHaveBeenCalledWith('2026-10-05T00:00:00.000Z', 25);
    expect(db.dueCleanup).toHaveBeenCalledWith(now.toISOString(), 25);
    expect(db.finishCleanup).toHaveBeenCalledWith('videos/old.mp4');
    expect(db.deleteMaterialByPath).toHaveBeenCalledWith('videos/old.mp4');
  });

  it('keeps cleanup intent and retries when Storage removal fails', async () => {
    const db = store({
      dueCleanup: vi.fn().mockResolvedValue([{ file_path: 'videos/late.mp4', created_at: '2026-10-05T00:00:00Z' }]),
      removeObject: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
    });
    expect(await reapVideoUploads(db, new Date('2026-10-06T00:00:00Z')))
      .toEqual({ abandoned: 0, cleaned: 0, errors: 1 });
    expect(db.finishCleanup).not.toHaveBeenCalled();
    expect(db.deferCleanup).toHaveBeenCalledWith('videos/late.mp4', '2026-10-06T00:15:00.000Z', 'Storage unavailable');
  });
});
