import { supabase } from '@/integrations/supabase/client';
import { uploadToStorageWithProgress } from './uploadWithProgress';

export interface VideoUploadProgress {
  stage: 'uploading' | 'parsing' | 'embedding' | 'done' | 'error';
  progress: number;
  statusText: string;
}

const LOG_PREFIX = '[video-pipeline]';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Upload a video file directly to Supabase Storage, then invoke
 * the transcribe-video edge function. The Whisper API accepts
 * video files (mp4, webm) natively — no client-side FFmpeg needed.
 */
export async function uploadVideoForTranscription(opts: {
  file: File;
  courseId: string;
  onProgress: (update: VideoUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<{ materialId: string }> {
  const { file, courseId, onProgress, signal } = opts;
  const t0 = performance.now();
  const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

  const checkCancelled = () => {
    if (signal?.aborted) throw new Error('Upload cancelled');
  };

  console.log(LOG_PREFIX, `Starting video upload for "${file.name}" (${formatBytes(file.size)})`);

  // --- 1. Upload video to Supabase Storage ---
  const timestamp = Date.now();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
  const storagePath = `${courseId}/videos/${timestamp}-${file.name}`;

  console.log(LOG_PREFIX, `[${elapsed()}] Step 1: Upload video to storage`);
  onProgress({
    stage: 'uploading',
    progress: 5,
    statusText: `Uploading video (${formatBytes(file.size)})... 0%`,
  });

  checkCancelled();

  await uploadToStorageWithProgress({
    bucket: 'course-materials',
    path: storagePath,
    body: file,
    contentType: file.type || `video/${ext}`,
    signal,
    onProgress: (fraction) => {
      const pct = Math.round(fraction * 100);
      onProgress({
        stage: 'uploading',
        progress: 5 + Math.round(fraction * 25), // 5–30%
        statusText: `Uploading video (${formatBytes(file.size)})... ${pct}%`,
      });
    },
  });

  console.log(LOG_PREFIX, `[${elapsed()}] Video uploaded to ${storagePath}`);
  checkCancelled();

  // --- 2. Create material record ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 2: Create material record`);
  const { data: material, error: materialError } = await supabase
    .from('materials')
    .insert({
      course_id: courseId,
      file_name: file.name,
      file_path: storagePath,
      file_type: 'video' as any,
      file_size: file.size,
      processing_status: 'pending' as any,
    })
    .select()
    .single();

  if (materialError || !material) {
    console.error(LOG_PREFIX, `[${elapsed()}] Failed to create material record:`, materialError);
    throw new Error(`Failed to create material record: ${materialError?.message}`);
  }

  console.log(LOG_PREFIX, `[${elapsed()}] Material record created: ${material.id}`);

  // --- 3. Invoke transcribe-video edge function ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 3: Invoke transcribe-video edge function`);
  onProgress({
    stage: 'parsing',
    progress: 35,
    statusText: 'Starting transcription...',
  });

  const { data: result, error: invokeError } = await supabase.functions.invoke(
    'transcribe-video',
    {
      body: {
        materialId: material.id,
        filePath: storagePath,
        bucketName: 'course-materials',
      },
    }
  );

  if (invokeError) {
    console.error(LOG_PREFIX, `[${elapsed()}] Edge function error:`, invokeError);
    throw new Error(`Transcription failed: ${invokeError.message}`);
  }

  if (result?.error) {
    console.error(LOG_PREFIX, `[${elapsed()}] Edge function returned error:`, result.error);
    throw new Error(result.error);
  }

  console.log(LOG_PREFIX, `[${elapsed()}] Edge function returned:`, result);

  const isDone = !result?.queued;

  onProgress({
    stage: isDone ? 'done' : 'parsing',
    progress: isDone ? 100 : 40,
    statusText: isDone
      ? 'Ready for student questions'
      : 'Transcribing in background...',
  });

  console.log(LOG_PREFIX, `[${elapsed()}] Pipeline complete — materialId=${material.id}`);

  return { materialId: material.id };
}
