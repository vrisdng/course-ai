import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';

import { supabase } from '@/integrations/supabase/client';
import { validateVideoSizeBytes } from '@/lib/videoUploadLimits';
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

interface R2Credentials {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
}

interface CreatedVideoUpload {
  materialId: string;
  filePath: string;
  uploaded: boolean;
  transcriptionStatus?: string;
  r2UploadId?: string;
  partSize?: number;
  credentials?: R2Credentials;
}

interface ListedParts {
  materialId: string;
  r2UploadId: string;
  parts: Array<{ partNumber: number; etag: string; size: number }>;
}

interface CompletedVideoUpload {
  materialId: string;
  uploaded: boolean;
  transcriptionStatus: string;
}

const RETRY_DELAYS_MS = [0, 1000, 3000, 5000, 10000];
const UPLOAD_CONCURRENCY = 3;
const STORAGE_KEY_PREFIX = 'educhat.video-upload.v1:';

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

async function invokeUploadSession<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  checkCancelled(signal);
  const { data, error } = await supabase.functions.invoke('video-upload-session', { body, signal });
  if (error) throw new Error(`Video upload session failed: ${error.message}`);
  if (!data || typeof data !== 'object' || 'error' in data) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Invalid video upload session response');
  }
  return data as T;
}

function r2Client(credentials: R2Credentials): S3Client {
  return new S3Client({
    endpoint: credentials.endpoint,
    region: credentials.region,
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });
}

function errorStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function isCredentialError(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'ExpiredToken' || name === 'InvalidToken' || errorStatus(error) === 401 || errorStatus(error) === 403;
}

function isRetryable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  checkCancelled(signal);
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new Error('Upload cancelled'));
    }, { once: true });
  });
}

function validateActiveSession(session: CreatedVideoUpload): asserts session is CreatedVideoUpload & {
  r2UploadId: string; partSize: number; credentials: R2Credentials;
} {
  const credentials = session.credentials;
  if (!session.materialId || !session.filePath || session.uploaded || !session.r2UploadId ||
    typeof session.partSize !== 'number' || session.partSize < 1 ||
    !credentials?.endpoint || !credentials.region || !credentials.bucket || !credentials.accessKeyId ||
    !credentials.secretAccessKey || !credentials.sessionToken) {
    throw new Error('Invalid video upload session response');
  }
}

async function uploadToR2(
  file: File,
  session: CreatedVideoUpload & { r2UploadId: string; partSize: number; credentials: R2Credentials },
  refreshSession: () => Promise<CreatedVideoUpload>,
  onProgress: VideoUploadOptions['onProgress'],
  signal?: AbortSignal,
): Promise<void> {
  checkCancelled(signal);
  const listed = await invokeUploadSession<ListedParts>({ action: 'list-parts', materialId: session.materialId }, signal);
  if (listed.materialId !== session.materialId || listed.r2UploadId !== session.r2UploadId || !Array.isArray(listed.parts)) {
    throw new Error('Invalid multipart upload state');
  }

  const partCount = Math.ceil(file.size / session.partSize);
  const accepted = new Map(listed.parts.map((part) => [part.partNumber, part.size]));
  const pending = Array.from({ length: partCount }, (_, index) => index + 1)
    .filter((partNumber) => !accepted.has(partNumber));
  let bytesUploaded = [...accepted.values()].reduce((sum, size) => sum + size, 0);
  let client = r2Client(session.credentials);
  let refreshPromise: Promise<void> | null = null;
  let cursor = 0;

  const reportProgress = () => {
    const percent = Math.min(100, Math.floor((bytesUploaded / file.size) * 100));
    onProgress({
      stage: 'uploading', progress: percent,
      statusText: `Uploading video: ${percent}% (${formatBytes(bytesUploaded)} of ${formatBytes(file.size)})`,
      bytesUploaded, bytesTotal: file.size,
    });
  };
  reportProgress();

  const refreshCredentials = async () => {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const refreshed = await refreshSession();
        validateActiveSession(refreshed);
        if (refreshed.materialId !== session.materialId || refreshed.r2UploadId !== session.r2UploadId) {
          throw new Error('Video upload identity changed during credential refresh');
        }
        client = r2Client(refreshed.credentials);
      })().finally(() => { refreshPromise = null; });
    }
    await refreshPromise;
  };

  const worker = async () => {
    while (cursor < pending.length) {
      const partNumber = pending[cursor++];
      const start = (partNumber - 1) * session.partSize;
      const end = Math.min(start + session.partSize, file.size);
      let refreshedCredentials = false;
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
        checkCancelled(signal);
        try {
          const response = await client.send(new UploadPartCommand({
            Bucket: session.credentials.bucket,
            Key: session.filePath,
            UploadId: session.r2UploadId,
            PartNumber: partNumber,
            Body: file.slice(start, end),
          }), { abortSignal: signal });
          if (!response.ETag) throw new Error(`R2 returned no ETag for part ${partNumber}`);
          bytesUploaded += end - start;
          reportProgress();
          break;
        } catch (error) {
          if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw new Error('Upload cancelled');
          if (!refreshedCredentials && isCredentialError(error)) {
            refreshedCredentials = true;
            await refreshCredentials();
            continue;
          }
          if (attempt === RETRY_DELAYS_MS.length - 1 || !isRetryable(error)) throw error;
          await waitForRetry(RETRY_DELAYS_MS[attempt + 1], signal);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker));
}

export async function uploadVideoForTranscription(opts: VideoUploadOptions): Promise<{ materialId: string; transcriptionStatus: string }> {
  const { file, courseId, academicTermId, accessScope, onProgress, signal } = opts;
  checkCancelled(signal);
  const sizeError = validateVideoSizeBytes(file.size);
  if (sizeError) throw new Error(sizeError);

  const storageKey = getUploadKeyStorageKey(opts);
  const uploadKey = getOrCreateUploadKey(storageKey);
  let materialId: string | undefined;
  let completionStarted = false;
  try {
    onProgress({ stage: 'uploading', progress: 0, statusText: 'Preparing video upload...', bytesUploaded: 0, bytesTotal: file.size });
    // Wait for create's response even if cancellation happens during it, so
    // we can identify and cancel a row the server may have already inserted.
    const createBody = {
      action: 'create-multipart', courseId, academicTermId, accessScope,
      fileName: file.name, fileSize: file.size, contentType: getVideoContentType(file), uploadKey,
    };
    const created = await invokeUploadSession<CreatedVideoUpload>(createBody);
    materialId = created.materialId;
    if (!created.materialId || !created.filePath || typeof created.uploaded !== 'boolean') {
      throw new Error('Invalid video upload session response');
    }
    if (created.uploaded) {
      if (typeof created.transcriptionStatus !== 'string') throw new Error('Invalid video upload session response');
      localStorage.removeItem(storageKey);
      return { materialId: created.materialId, transcriptionStatus: created.transcriptionStatus };
    }
    validateActiveSession(created);
    checkCancelled(signal);
    await uploadToR2(file, created, () => invokeUploadSession<CreatedVideoUpload>(createBody, signal), onProgress, signal);
    checkCancelled(signal);
    onProgress({ stage: 'parsing', progress: 100, statusText: 'Verifying video and starting transcription...', bytesUploaded: file.size, bytesTotal: file.size });
    completionStarted = true;
    const completed = await invokeUploadSession<CompletedVideoUpload>({ action: 'complete-multipart', materialId: created.materialId }, signal);
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
          await supabase.functions.invoke('video-upload-session', { body: { action: 'abort-multipart', materialId } });
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
