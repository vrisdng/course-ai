import { Upload } from 'tus-js-client';

import { supabase } from '@/integrations/supabase/client';
import { VIDEO_MAX_FILE_SIZE_BYTES } from '@/lib/materialUpload';
import { formatBytes } from '@/lib/utils';

export interface VideoUploadProgress {
  stage: 'uploading' | 'parsing' | 'embedding' | 'done' | 'error';
  progress: number;
  statusText: string;
  bytesUploaded?: number;
  bytesTotal?: number;
}

interface VideoUploadOptions {
  file: File;
  courseId: string;
  academicTermId: string;
  accessScope: 'course' | 'public' | 'private';
  uploaderId: string;
  onProgress: (update: VideoUploadProgress) => void;
  signal?: AbortSignal;
}

interface CreatedVideoUpload {
  materialId: string;
  filePath: string;
  uploaded: boolean;
}

interface CompletedVideoUpload {
  materialId: string;
  uploaded: boolean;
  transcriptionStatus: string;
}

const BUCKET = 'course-materials';
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const RETRY_DELAYS_MS = [0, 3000, 5000, 10000, 20000];
const STORAGE_KEY_PREFIX = 'educhat.video-upload.v1:';
const MAX_RESUMABLE_URL_AGE_MS = 23 * 60 * 60 * 1000;

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Upload cancelled');
}

function getVideoContentType(file: File): string {
  return file.type || (file.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4');
}

function getUploadKeyStorageKey(opts: VideoUploadOptions): string {
  const { file, uploaderId, courseId, academicTermId, accessScope } = opts;
  return STORAGE_KEY_PREFIX + JSON.stringify([
    uploaderId, courseId, academicTermId, accessScope, file.name, file.size, file.lastModified,
  ]);
}

function getOrCreateUploadKey(storageKey: string): string {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) {
      return saved;
    }
    const uploadKey = crypto.randomUUID();
    localStorage.setItem(storageKey, uploadKey);
    return uploadKey;
  } catch {
    throw new Error('Browser storage is unavailable; enable it to resume large video uploads.');
  }
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Could not refresh upload authentication: ${error.message}`);
  if (!data.session?.access_token) throw new Error('Not authenticated');
  return data.session.access_token;
}

async function invokeUploadSession<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  checkCancelled(signal);
  const { data, error } = await supabase.functions.invoke('video-upload-session', { body, signal });
  checkCancelled(signal);
  if (error) throw new Error(`Video upload session failed: ${error.message}`);
  if (!data || typeof data !== 'object' || 'error' in data) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Invalid video upload session response');
  }
  return data as T;
}

function uploadToStorage(
  file: File,
  filePath: string,
  onProgress: VideoUploadOptions['onProgress'],
  signal?: AbortSignal
): Promise<void> {
  checkCancelled(signal);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let resumedUrlStorageKey: string | null = null;
    let retriedExpiredUrl = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      void upload.abort(false).catch(() => undefined);
      finish(new Error('Upload cancelled'));
    };

    const upload = new Upload(file, {
      endpoint: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/upload/resumable`,
      headers: {},
      retryDelays: RETRY_DELAYS_MS,
      chunkSize: TUS_CHUNK_SIZE,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      // A path belongs to one material; an older upload of the same file must
      // never be resumed against a different material or access scope.
      fingerprint: async () => `educhat:${BUCKET}:${filePath}:${file.size}:${file.lastModified}`,
      metadata: {
        bucketName: BUCKET,
        objectName: filePath,
        contentType: getVideoContentType(file),
        cacheControl: '3600',
      },
      // Supabase may refresh its JWT during a multi-hour transfer. This hook
      // runs before each create, HEAD, and PATCH request, including retries.
      onBeforeRequest: async (request) => {
        checkCancelled(signal);
        request.setHeader('authorization', `Bearer ${await getAccessToken()}`);
        request.setHeader('apikey', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        if (settled || signal?.aborted) return;
        const total = bytesTotal ?? file.size;
        const percent = total > 0 ? Math.min(100, Math.floor((bytesUploaded / total) * 100)) : 0;
        onProgress({
          stage: 'uploading',
          progress: percent,
          statusText: `Uploading video: ${percent}% (${formatBytes(bytesUploaded)} of ${formatBytes(total)})`,
          bytesUploaded,
          bytesTotal: total,
        });
      },
      onError: (error) => {
        const response = (error as { originalResponse?: { getStatus?: () => number } }).originalResponse;
        const status = response?.getStatus?.();
        if (resumedUrlStorageKey && !retriedExpiredUrl && (status === 404 || status === 410) && !signal?.aborted) {
          retriedExpiredUrl = true;
          const staleKey = resumedUrlStorageKey;
          resumedUrlStorageKey = null;
          void Promise.resolve(upload.options.urlStorage?.removeUpload(staleKey)).then(() => {
            upload.url = null;
            upload.start();
          }).catch((storageError: unknown) => {
            finish(storageError instanceof Error ? storageError : new Error(String(storageError)));
          });
          return;
        }
        finish(error);
      },
      onSuccess: () => finish(),
    });

    signal?.addEventListener('abort', onAbort, { once: true });
    void upload.findPreviousUploads().then((previousUploads) => {
      if (settled || signal?.aborted) return;
      const previous = previousUploads.find((entry) => {
        const createdAt = Date.parse(entry.creationTime);
        return entry.metadata?.bucketName === BUCKET &&
          entry.metadata.objectName === filePath &&
          Number.isFinite(createdAt) &&
          Date.now() - createdAt < MAX_RESUMABLE_URL_AGE_MS;
      });
      if (previous) {
        resumedUrlStorageKey = previous.urlStorageKey;
        upload.resumeFromPreviousUpload(previous);
      }
      upload.start();
    }).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export async function uploadVideoForTranscription(opts: VideoUploadOptions): Promise<{ materialId: string; transcriptionStatus: string }> {
  const { file, courseId, academicTermId, accessScope, onProgress, signal } = opts;
  checkCancelled(signal);
  if (file.size > VIDEO_MAX_FILE_SIZE_BYTES) {
    throw new Error('Video files must be 3 GB or smaller.');
  }
  if (file.size === 0) throw new Error('Video file is empty.');

  const storageKey = getUploadKeyStorageKey(opts);
  const uploadKey = getOrCreateUploadKey(storageKey);
  let materialId: string | undefined;
  let completionStarted = false;
  try {
    onProgress({ stage: 'uploading', progress: 0, statusText: 'Preparing video upload...', bytesUploaded: 0, bytesTotal: file.size });
    // Wait for create's response even if cancellation happens during it, so
    // we can identify and cancel a row the server may have already inserted.
    const created = await invokeUploadSession<CreatedVideoUpload>({
      action: 'create', courseId, academicTermId, accessScope,
      fileName: file.name, fileSize: file.size, contentType: getVideoContentType(file), uploadKey,
    });
    materialId = created.materialId;
    if (!created.materialId || !created.filePath || typeof created.uploaded !== 'boolean') {
      throw new Error('Invalid video upload session response');
    }
    checkCancelled(signal);
    if (!created.uploaded) {
      await uploadToStorage(file, created.filePath, onProgress, signal);
    }
    checkCancelled(signal);
    onProgress({ stage: 'parsing', progress: 100, statusText: 'Verifying video and starting transcription...', bytesUploaded: file.size, bytesTotal: file.size });
    completionStarted = true;
    const completed = await invokeUploadSession<CompletedVideoUpload>({ action: 'complete', materialId: created.materialId }, signal);
    if (completed.materialId !== created.materialId || completed.uploaded !== true || typeof completed.transcriptionStatus !== 'string') {
      throw new Error('Invalid video completion response');
    }
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // A complete upload is still valid if browser storage becomes unavailable.
    }
    if (completed.transcriptionStatus === 'failed') {
      onProgress({ stage: 'error', progress: 100, statusText: 'Transcription failed; retry from Materials.' });
    } else {
      onProgress({ stage: 'parsing', progress: 100, statusText: 'Transcribing in background...' });
    }
    return { materialId: created.materialId, transcriptionStatus: completed.transcriptionStatus };
  } catch (error) {
    if (signal?.aborted && !completionStarted) {
      if (materialId) {
        try {
          await supabase.functions.invoke('video-upload-session', { body: { action: 'cancel', materialId } });
        } catch {
          // The server's abandoned-upload reconciler handles a failed cancel.
        }
      }
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Cancellation still takes effect for this browser session.
      }
    }
    throw error;
  }
}
