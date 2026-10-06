export const MAX_VIDEO_BYTES = 3_000_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm' };

export interface UploadUser { userId: string; profileId: string }
export interface UploadMaterial {
  id: string;
  course_id: string;
  academic_term_id: string;
  access_scope: 'course' | 'public' | 'private';
  uploaded_by: string;
  file_name: string;
  file_size: number;
  file_type: string;
  file_path: string;
  video_content_type: string;
  video_upload_key: string | null;
  video_upload_state: string;
}
export interface NewUploadMaterial extends UploadMaterial {
  is_public: boolean;
  processing_status: 'pending';
  processing_stage: 'uploading';
  processing_progress: number;
}
export interface StoredObjectInfo { size: number; contentType: string }
export interface CleanupEntry { file_path: string; created_at: string }
export interface UploadSessionStore {
  courseExists(id: string): Promise<boolean>;
  termExists(id: string): Promise<boolean>;
  findByKey(profileId: string, key: string): Promise<UploadMaterial | null>;
  findMaterial(id: string): Promise<UploadMaterial | null>;
  createMaterial(material: NewUploadMaterial): Promise<UploadMaterial>;
  objectInfo(path: string): Promise<StoredObjectInfo | null>;
  markUploaded(id: string): Promise<void>;
  markCancelled(id: string): Promise<void>;
  markDeleting(id: string): Promise<void>;
  deleteMaterial(id: string): Promise<void>;
  deleteMaterialByPath(path: string): Promise<void>;
  recordCleanup(path: string): Promise<void>;
  removeObject(path: string): Promise<void>;
  enqueueTranscription(id: string): Promise<{ status: string }>;
  transcriptionStatus(id: string): Promise<string>;
  staleUploads(before: string, limit: number): Promise<UploadMaterial[]>;
  dueCleanup(before: string, limit: number): Promise<CleanupEntry[]>;
  deferCleanup(path: string, nextAt: string, error: string | null): Promise<void>;
  finishCleanup(path: string): Promise<void>;
}

export type SessionResult = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): SessionResult => ({ status, body });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnsafeNameCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === '/' || character === '\\';
  });
}

function sameUpload(material: UploadMaterial, input: Record<string, unknown>): boolean {
  return material.course_id === input.courseId &&
    material.academic_term_id === input.academicTermId &&
    material.access_scope === input.accessScope &&
    material.file_name === input.fileName &&
    material.file_size === input.fileSize &&
    material.video_content_type === input.contentType &&
    material.file_type === 'video';
}

async function uploaded(material: UploadMaterial, store: UploadSessionStore): Promise<boolean> {
  const info = await store.objectInfo(material.file_path);
  return info !== null && info.size === material.file_size && info.contentType === material.video_content_type;
}

export async function handleUploadSession(
  body: unknown,
  user: UploadUser,
  store: UploadSessionStore,
  newId: () => string = () => crypto.randomUUID(),
): Promise<SessionResult> {
  if (!isRecord(body)) return reply(400, { error: 'Invalid request body' });

  if (body.action === 'create') {
    const { courseId, academicTermId, accessScope, fileName, fileSize, contentType, uploadKey } = body;
    if (!UUID.test(String(courseId)) || !UUID.test(String(academicTermId)) ||
      !['course', 'public', 'private'].includes(String(accessScope)) ||
      typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 255 ||
      hasUnsafeNameCharacter(fileName) ||
      typeof contentType !== 'string' || !(contentType in VIDEO_TYPES) ||
      !fileName.toLowerCase().endsWith(`.${VIDEO_TYPES[contentType]}`) ||
      typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) ||
      fileSize < 1 || fileSize > MAX_VIDEO_BYTES ||
      (uploadKey !== undefined && !UUID.test(String(uploadKey)))) {
      return reply(400, { error: 'Invalid video upload parameters' });
    }
    const key = typeof uploadKey === 'string' ? uploadKey : null;
    if (!await store.courseExists(courseId as string) || !await store.termExists(academicTermId as string)) {
      return reply(400, { error: 'Course or academic term does not exist' });
    }

    const existing = key ? await store.findByKey(user.profileId, key) : null;
    if (existing) {
      if (!sameUpload(existing, body) || ['cancelled', 'deleting'].includes(existing.video_upload_state)) {
        return reply(409, { error: 'Upload key was already used for different parameters' });
      }
      return reply(200, { materialId: existing.id, filePath: existing.file_path, uploaded: await uploaded(existing, store) });
    }

    const id = newId();
    const path = `videos/${user.userId}/${id}.${VIDEO_TYPES[contentType]}`;
    const record: NewUploadMaterial = {
      id, course_id: courseId as string, academic_term_id: academicTermId as string,
      access_scope: accessScope as UploadMaterial['access_scope'], uploaded_by: user.profileId,
      file_name: fileName, file_size: fileSize, file_type: 'video', file_path: path,
      video_content_type: contentType, video_upload_key: key, video_upload_state: 'uploading',
      is_public: accessScope === 'public', processing_status: 'pending',
      processing_stage: 'uploading', processing_progress: 0,
    };
    try {
      const created = await store.createMaterial(record);
      return reply(200, { materialId: created.id, filePath: created.file_path, uploaded: false });
    } catch (error) {
      // Two create requests with the same key may race at the unique index.
      const raced = key ? await store.findByKey(user.profileId, key) : null;
      if (raced) {
        if (!sameUpload(raced, body) || ['cancelled', 'deleting'].includes(raced.video_upload_state)) {
          return reply(409, { error: 'Upload key was already used for different parameters' });
        }
        return reply(200, { materialId: raced.id, filePath: raced.file_path, uploaded: await uploaded(raced, store) });
      }
      throw error;
    }
  }

  if (body.action === 'complete') {
    if (!UUID.test(String(body.materialId))) return reply(400, { error: 'Invalid material ID' });
    const material = await store.findMaterial(body.materialId as string);
    if (!material || material.uploaded_by !== user.profileId || material.file_type !== 'video' ||
      !material.file_path.startsWith(`videos/${user.userId}/`) ||
      !['uploading', 'uploaded'].includes(material.video_upload_state)) {
      return reply(404, { error: 'Video upload not found' });
    }
    if (!await uploaded(material, store)) {
      return reply(409, { error: 'Video is missing, incomplete, or has unexpected metadata' });
    }
    await store.markUploaded(material.id);
    let transcriptionStatus: string;
    try {
      const job = await store.enqueueTranscription(material.id);
      transcriptionStatus = job.status;
    } catch (error) {
      // The durable upload is complete. A provider or function failure belongs
      // to transcription, and the reconciler can resubmit a pending job.
      console.error('[video-upload-session] Transcription enqueue failed', material.id, error);
      try {
        transcriptionStatus = await store.transcriptionStatus(material.id);
      } catch {
        transcriptionStatus = 'pending';
      }
    }
    return reply(200, { materialId: material.id, filePath: material.file_path, uploaded: true, transcriptionStatus });
  }

  if (body.action === 'cancel') {
    if (!UUID.test(String(body.materialId))) return reply(400, { error: 'Invalid material ID' });
    const material = await store.findMaterial(body.materialId as string);
    if (!material) return reply(200, { materialId: body.materialId, cancelled: true });
    if (material.uploaded_by !== user.profileId || material.file_type !== 'video' ||
      !material.file_path.startsWith(`videos/${user.userId}/`)) {
      return reply(404, { error: 'Video upload not found' });
    }
    if (material.video_upload_state === 'uploaded' || material.video_upload_state === 'deleting') {
      return reply(409, { error: 'Completed video cannot be cancelled as an upload' });
    }
    // Record cleanup intent first so a late TUS completion cannot orphan bytes.
    await store.recordCleanup(material.file_path);
    await store.markCancelled(material.id);
    await store.removeObject(material.file_path);
    await store.deleteMaterial(material.id);
    return reply(200, { materialId: material.id, cancelled: true });
  }

  if (body.action === 'delete') {
    if (!UUID.test(String(body.materialId))) return reply(400, { error: 'Invalid material ID' });
    const material = await store.findMaterial(body.materialId as string);
    if (!material) return reply(200, { materialId: body.materialId, deleted: true });
    if (material.file_type !== 'video' || !/^videos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|webm)$/i.test(material.file_path)) {
      return reply(400, { error: 'Material is not a stored video' });
    }
    await store.recordCleanup(material.file_path);
    await store.markDeleting(material.id);
    await store.removeObject(material.file_path);
    await store.deleteMaterial(material.id);
    return reply(200, { materialId: material.id, deleted: true });
  }

  return reply(400, { error: 'Unsupported action' });
}

export async function reapVideoUploads(
  store: UploadSessionStore,
  now: Date = new Date(),
): Promise<{ abandoned: number; cleaned: number; errors: number }> {
  // A resumable transfer may legitimately be paused. Give it 24 hours before
  // abandoning, and keep its path in the cleanup ledger for another 30 days.
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const ledgerExpiresBefore = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const retryAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  let abandoned = 0;
  let cleaned = 0;
  let errors = 0;

  const stale = await store.staleUploads(staleBefore, 25);
  for (const material of stale) {
    try {
      await store.recordCleanup(material.file_path);
      await store.markCancelled(material.id);
      await store.removeObject(material.file_path);
      await store.deleteMaterial(material.id);
      abandoned += 1;
    } catch (error) {
      errors += 1;
      console.error('[video-upload-session] Failed to abandon stale upload', material.id, error);
    }
  }

  const due = await store.dueCleanup(now.toISOString(), 25);
  for (const entry of due) {
    try {
      await store.removeObject(entry.file_path);
      await store.deleteMaterialByPath(entry.file_path);
      if (new Date(entry.created_at).getTime() < ledgerExpiresBefore) {
        await store.finishCleanup(entry.file_path);
      } else {
        await store.deferCleanup(entry.file_path, retryAt, null);
      }
      cleaned += 1;
    } catch (error) {
      errors += 1;
      await store.deferCleanup(entry.file_path, retryAt, error instanceof Error ? error.message : 'Unknown cleanup error');
    }
  }
  return { abandoned, cleaned, errors };
}
