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
  storage_provider: StorageProvider;
}
export interface NewUploadMaterial extends UploadMaterial {
  is_public: boolean;
  processing_status: 'pending';
  processing_stage: 'uploading';
  processing_progress: number;
}
export interface StoredObjectInfo { size: number; contentType: string }
export interface CleanupEntry {
  file_path: string;
  created_at: string;
  storage_provider: StorageProvider | null;
  object_key: string | null;
  r2_multipart_upload_id: string | null;
}

export type StorageProvider = 'supabase' | 'r2';

export interface R2Part { partNumber: number; etag: string; size: number }
export interface R2MultipartUpload {
  objectKey: string;
  r2UploadId: string;
  partSize: number;
  expiresAt: string;
}

// The R2 operations a browser performs directly against private R2. Credentials
// issued for a session are scoped to these actions only.
export const R2_MULTIPART_ACTIONS = ['UploadPart'] as const;

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
  recordCleanup(path: string, provider: StorageProvider, r2UploadId?: string): Promise<void>;
  removeObject(path: string, provider: StorageProvider): Promise<void>;
  enqueueTranscription(id: string): Promise<{ status: string }>;
  transcriptionStatus(id: string): Promise<string>;
  staleUploads(before: string, limit: number): Promise<UploadMaterial[]>;
  dueCleanup(before: string, limit: number): Promise<CleanupEntry[]>;
  deferCleanup(path: string, nextAt: string, error: string | null): Promise<void>;
  finishCleanup(path: string): Promise<void>;
  // R2 multipart upload (Phase 1). Every method here talks to Cloudflare R2 or the
  // durable multipart ledger so the orchestration stays provider-neutral and
  // unit-testable; core.ts never calls R2 directly.
  createR2MultipartUpload(filePath: string, contentType: string, fileSize: number): Promise<R2MultipartUpload>;
  listR2Parts(objectKey: string, r2UploadId: string): Promise<R2Part[]>;
  completeR2MultipartUpload(
    objectKey: string, r2UploadId: string, parts: R2Part[],
  ): Promise<{ size: number; contentType: string }>;
  abortR2MultipartUpload(objectKey: string, r2UploadId: string): Promise<void>;
  issueR2Credentials(objectKey: string, allowedActions: readonly string[]): Promise<Record<string, string>>;
  saveMultipartUpload(id: string, upload: R2MultipartUpload): Promise<void>;
  loadMultipartUpload(id: string): Promise<R2MultipartUpload | null>;
  finishMultipartUpload(id: string): Promise<void>;
  abandonMultipartUpload(id: string): Promise<void>;
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

interface ValidatedCreateParams {
  courseId: string;
  academicTermId: string;
  accessScope: UploadMaterial['access_scope'];
  fileName: string;
  fileSize: number;
  contentType: string;
  uploadKey: string | null;
}

function validateCreateParams(body: Record<string, unknown>): ValidatedCreateParams | null {
  const { courseId, academicTermId, accessScope, fileName, fileSize, contentType, uploadKey } = body;
  if (!UUID.test(String(courseId)) || !UUID.test(String(academicTermId)) ||
    !['course', 'public', 'private'].includes(String(accessScope)) ||
    typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 255 ||
    hasUnsafeNameCharacter(fileName) ||
    typeof contentType !== 'string' || !(contentType in VIDEO_TYPES) ||
    !fileName.toLowerCase().endsWith(`.${VIDEO_TYPES[contentType]}`) ||
    typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) ||
    fileSize < 1 ||
    (uploadKey !== undefined && !UUID.test(String(uploadKey)))) {
    return null;
  }
  return {
    courseId: courseId as string,
    academicTermId: academicTermId as string,
    accessScope: accessScope as UploadMaterial['access_scope'],
    fileName: fileName as string,
    fileSize: fileSize as number,
    contentType: contentType as string,
    uploadKey: typeof uploadKey === 'string' ? uploadKey : null,
  };
}

// R2 stores the source video under videos/{materialId}/source.{ext}.
function r2VideoPath(materialId: string, ext: string): string {
  return `videos/${materialId}/source.${ext}`;
}

function isStoredVideoPath(material: UploadMaterial): boolean {
  const pattern = material.storage_provider === 'r2'
    ? /^videos\/[0-9a-f-]{36}\/source\.(mp4|webm)$/i
    : /^videos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|webm)$/i;
  return pattern.test(material.file_path);
}

function verifiedR2Parts(parts: R2Part[], fileSize: number, partSize: number): R2Part[] | null {
  const expectedCount = Math.ceil(fileSize / partSize);
  if (parts.length !== expectedCount) return null;
  const sorted = parts.slice().sort((a, b) => a.partNumber - b.partNumber);
  for (let index = 0; index < sorted.length; index += 1) {
    const part = sorted[index];
    const expectedSize = index === sorted.length - 1
      ? fileSize - partSize * (expectedCount - 1)
      : partSize;
    if (part.partNumber !== index + 1 || !part.etag || part.size !== expectedSize) return null;
  }
  return sorted;
}

async function ensureR2MultipartUpload(
  material: UploadMaterial,
  store: UploadSessionStore,
): Promise<R2MultipartUpload> {
  const existing = await store.loadMultipartUpload(material.id);
  if (existing) return existing;

  const created = await store.createR2MultipartUpload(
    material.file_path,
    material.video_content_type,
    material.file_size,
  );
  try {
    await store.saveMultipartUpload(material.id, created);
    return created;
  } catch (error) {
    const raced = await store.loadMultipartUpload(material.id);
    try {
      await store.abortR2MultipartUpload(created.objectKey, created.r2UploadId);
    } catch (abortError) {
      console.error('[video-upload-session] Failed to abort losing R2 multipart race', material.id, abortError);
    }
    if (raced) return raced;
    throw error;
  }
}

export async function handleUploadSession(
  body: unknown,
  user: UploadUser,
  store: UploadSessionStore,
  newId: () => string = () => crypto.randomUUID(),
): Promise<SessionResult> {
  if (!isRecord(body)) return reply(400, { error: 'Invalid request body' });

  if (body.action === 'create') {
    const params = validateCreateParams(body);
    if (!params) return reply(400, { error: 'Invalid video upload parameters' });
    const { courseId, academicTermId, accessScope, fileName, fileSize, contentType, uploadKey } = params;
    if (!await store.courseExists(courseId) || !await store.termExists(academicTermId)) {
      return reply(400, { error: 'Course or academic term does not exist' });
    }

    const existing = uploadKey ? await store.findByKey(user.profileId, uploadKey) : null;
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
      video_content_type: contentType, video_upload_key: uploadKey, video_upload_state: 'uploading',
      storage_provider: 'supabase',
      is_public: accessScope === 'public', processing_status: 'pending',
      processing_stage: 'uploading', processing_progress: 0,
    };
    try {
      const created = await store.createMaterial(record);
      return reply(200, { materialId: created.id, filePath: created.file_path, uploaded: false });
    } catch (error) {
      // Two create requests with the same key may race at the unique index.
      const raced = uploadKey ? await store.findByKey(user.profileId, uploadKey) : null;
      if (raced) {
        if (!sameUpload(raced, body) || ['cancelled', 'deleting'].includes(raced.video_upload_state)) {
          return reply(409, { error: 'Upload key was already used for different parameters' });
        }
        return reply(200, { materialId: raced.id, filePath: raced.file_path, uploaded: await uploaded(raced, store) });
      }
      throw error;
    }
  }

  if (body.action === 'create-multipart') {
    const params = validateCreateParams(body);
    if (!params) return reply(400, { error: 'Invalid video upload parameters' });
    const { courseId, academicTermId, accessScope, fileName, fileSize, contentType, uploadKey } = params;
    if (!await store.courseExists(courseId) || !await store.termExists(academicTermId)) {
      return reply(400, { error: 'Course or academic term does not exist' });
    }

    const existing = uploadKey ? await store.findByKey(user.profileId, uploadKey) : null;
    if (existing) {
      if (!sameUpload(existing, body) || ['cancelled', 'deleting'].includes(existing.video_upload_state)) {
        return reply(409, { error: 'Upload key was already used for different parameters' });
      }
      if (existing.storage_provider !== 'r2') {
        return reply(409, { error: 'Upload key belongs to a different storage provider' });
      }
      if (existing.video_upload_state === 'uploaded') {
        return reply(200, {
          materialId: existing.id,
          filePath: existing.file_path,
          uploaded: true,
          transcriptionStatus: await store.transcriptionStatus(existing.id),
        });
      }
      // Resume: return the in-progress upload identity and fresh credentials so the
      // browser can continue accepted parts (server is the source of truth).
      const upload = await ensureR2MultipartUpload(existing, store);
      const credentials = await store.issueR2Credentials(existing.file_path, R2_MULTIPART_ACTIONS);
      return reply(200, { materialId: existing.id, filePath: existing.file_path, r2UploadId: upload.r2UploadId, partSize: upload.partSize, credentials, uploaded: false });
    }

    const id = newId();
    const path = r2VideoPath(id, VIDEO_TYPES[contentType]);
    const record: NewUploadMaterial = {
      id, course_id: courseId, academic_term_id: academicTermId,
      access_scope: accessScope, uploaded_by: user.profileId,
      file_name: fileName, file_size: fileSize, file_type: 'video', file_path: path,
      video_content_type: contentType, video_upload_key: uploadKey, video_upload_state: 'uploading',
      is_public: accessScope === 'public', processing_status: 'pending',
      processing_stage: 'uploading', processing_progress: 0, storage_provider: 'r2',
    };
    try {
      const created = await store.createMaterial(record);
      const upload = await ensureR2MultipartUpload({ ...created, storage_provider: 'r2' }, store);
      const credentials = await store.issueR2Credentials(path, R2_MULTIPART_ACTIONS);
      return reply(200, {
        materialId: created.id, filePath: path, r2UploadId: upload.r2UploadId,
        partSize: upload.partSize, credentials, uploaded: false,
      });
    } catch (error) {
      // Two create requests with the same key may race at the unique index.
      const raced = uploadKey ? await store.findByKey(user.profileId, uploadKey) : null;
      if (raced) {
        if (!sameUpload(raced, body) || raced.storage_provider !== 'r2' ||
          ['cancelled', 'deleting'].includes(raced.video_upload_state)) {
          return reply(409, { error: 'Upload key was already used for different parameters' });
        }
        const upload = await ensureR2MultipartUpload(raced, store);
        const credentials = await store.issueR2Credentials(raced.file_path, R2_MULTIPART_ACTIONS);
        return reply(200, {
          materialId: raced.id, filePath: raced.file_path, r2UploadId: upload.r2UploadId,
          partSize: upload.partSize, credentials, uploaded: false,
        });
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
    await store.recordCleanup(material.file_path, material.storage_provider);
    await store.markCancelled(material.id);
    await store.removeObject(material.file_path, material.storage_provider);
    await store.deleteMaterial(material.id);
    return reply(200, { materialId: material.id, cancelled: true });
  }

  if (body.action === 'delete') {
    if (!UUID.test(String(body.materialId))) return reply(400, { error: 'Invalid material ID' });
    const material = await store.findMaterial(body.materialId as string);
    if (!material) return reply(200, { materialId: body.materialId, deleted: true });
    if (material.file_type !== 'video' || !isStoredVideoPath(material)) {
      return reply(400, { error: 'Material is not a stored video' });
    }
    await store.recordCleanup(material.file_path, material.storage_provider);
    await store.markDeleting(material.id);
    await store.removeObject(material.file_path, material.storage_provider);
    await store.deleteMaterial(material.id);
    return reply(200, { materialId: material.id, deleted: true });
  }

  if (body.action === 'list-parts') {
    if (!UUID.test(String(body.materialId))) return reply(400, { error: 'Invalid material ID' });
    const material = await store.findMaterial(body.materialId as string);
    if (!material || material.uploaded_by !== user.profileId || material.file_type !== 'video' ||
      material.storage_provider !== 'r2' || material.video_upload_state !== 'uploading') {
      return reply(404, { error: 'Video multipart upload not found' });
    }
    const upload = await store.loadMultipartUpload(material.id);
    if (!upload) return reply(404, { error: 'Multipart upload state is missing' });
    const parts = await store.listR2Parts(upload.objectKey, upload.r2UploadId);
    return reply(200, { materialId: material.id, r2UploadId: upload.r2UploadId, parts });
  }

  if (body.action === 'complete-multipart') {
    if (!UUID.test(String(body.materialId))) return reply(400, { error: 'Invalid material ID' });
    const material = await store.findMaterial(body.materialId as string);
    if (!material || material.uploaded_by !== user.profileId || material.file_type !== 'video' ||
      material.storage_provider !== 'r2' || material.video_upload_state !== 'uploading') {
      return reply(404, { error: 'Video multipart upload not found' });
    }
    const upload = await store.loadMultipartUpload(material.id);
    if (!upload) return reply(404, { error: 'Multipart upload state is missing' });
    const parts = verifiedR2Parts(
      await store.listR2Parts(upload.objectKey, upload.r2UploadId),
      material.file_size,
      upload.partSize,
    );
    if (!parts) return reply(409, { error: 'R2 has not accepted every expected video part' });

    let size: number;
    let contentType: string;
    try {
      const verified = await store.completeR2MultipartUpload(upload.objectKey, upload.r2UploadId, parts);
      size = verified.size;
      contentType = verified.contentType;
    } catch (error) {
      console.error('[video-upload-session] R2 multipart completion failed', material.id, error);
      return reply(502, { error: 'Failed to finalize the uploaded video parts' });
    }
    // R2 verifies checksums, but never trust the result blindly: a size or content
    // type mismatch means the stored object is unusable, so abandon the upload.
    if (size !== material.file_size || contentType !== material.video_content_type) {
      await store.abandonMultipartUpload(material.id);
      return reply(409, { error: 'Stored video size or content type did not match the record' });
    }
    await store.markUploaded(material.id);
    await store.finishMultipartUpload(material.id);
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

  if (body.action === 'abort-multipart') {
    if (!UUID.test(String(body.materialId))) return reply(400, { error: 'Invalid material ID' });
    const material = await store.findMaterial(body.materialId as string);
    if (!material) return reply(200, { materialId: body.materialId, aborted: true });
    if (material.uploaded_by !== user.profileId || material.file_type !== 'video' ||
      material.storage_provider !== 'r2' ||
      material.video_upload_state === 'uploaded' || material.video_upload_state === 'deleting') {
      if (material.video_upload_state === 'uploaded') return reply(409, { error: 'Completed video cannot be aborted as an upload' });
      return reply(404, { error: 'Video multipart upload not found' });
    }
    const upload = await store.loadMultipartUpload(material.id);
    await store.recordCleanup(material.file_path, 'r2', upload?.r2UploadId);
    await store.markCancelled(material.id);
    if (upload) {
      // Abort before clearing state so a racing completed part cannot resurrect it.
      try {
        await store.abortR2MultipartUpload(upload.objectKey, upload.r2UploadId);
      } catch (error) {
        console.error('[video-upload-session] R2 multipart abort failed', material.id, error);
      }
      await store.abandonMultipartUpload(material.id);
    }
    // DeleteObject is idempotent and catches a completion racing the abort.
    await store.removeObject(material.file_path, 'r2');
    await store.deleteMaterial(material.id);
    return reply(200, { materialId: material.id, aborted: true });
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
      const upload = material.storage_provider === 'r2'
        ? await store.loadMultipartUpload(material.id)
        : null;
      await store.recordCleanup(material.file_path, material.storage_provider, upload?.r2UploadId);
      await store.markCancelled(material.id);
      if (upload) {
        await store.abortR2MultipartUpload(upload.objectKey, upload.r2UploadId);
        await store.abandonMultipartUpload(material.id);
      }
      await store.removeObject(material.file_path, material.storage_provider);
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
      const provider = entry.storage_provider ?? 'supabase';
      const objectKey = entry.object_key ?? entry.file_path;
      if (provider === 'r2' && entry.r2_multipart_upload_id) {
        await store.abortR2MultipartUpload(objectKey, entry.r2_multipart_upload_id);
      }
      await store.removeObject(objectKey, provider);
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
