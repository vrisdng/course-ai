import { supabase } from '@/integrations/supabase/client';

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
 * Animates progress from `from` to `to` over `durationMs` milliseconds,
 * calling `onProgress` on each tick. Returns a cancel function.
 */
function animateProgress(
  from: number,
  to: number,
  durationMs: number,
  onProgress: (value: number) => void
): () => void {
  const startTime = performance.now();
  let rafId: number;

  const tick = () => {
    const elapsed = performance.now() - startTime;
    const fraction = Math.min(elapsed / durationMs, 1);
    // Ease-out so it slows down near the target (never quite reaches it)
    const eased = 1 - Math.pow(1 - fraction, 2);
    const value = Math.round(from + eased * (to - from));
    onProgress(value);
    if (fraction < 1) {
      rafId = requestAnimationFrame(tick);
    }
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

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

  // --- 1. Upload video to AssemblyAI via edge function proxy ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 1: Upload video to AssemblyAI`);

  // Start fake progress animation: 0 → 85% over 60 seconds
  let cancelAnimation = animateProgress(0, 85, 60_000, (value) => {
    onProgress({
      stage: 'uploading',
      progress: value,
      statusText: `Uploading video (${formatBytes(file.size)})...`,
    });
  });

  checkCancelled();

  let uploadUrl: string;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-video`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': file.type || 'video/mp4',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: file,
        signal,
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(err.error || `Upload failed: ${response.status}`);
    }

    const result = await response.json();
    if (!result.uploadUrl) throw new Error('No upload URL returned from server');
    uploadUrl = result.uploadUrl;
  } finally {
    cancelAnimation();
  }

  console.log(LOG_PREFIX, `[${elapsed()}] Video uploaded to AssemblyAI — got URL`);
  checkCancelled();

  onProgress({ stage: 'uploading', progress: 90, statusText: 'Creating material record...' });

  // --- 2. Create material record ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 2: Create material record`);
  const { data: material, error: materialError } = await supabase
    .from('materials')
    .insert({
      course_id: courseId,
      file_name: file.name,
      file_path: '',           // no local storage
      file_type: 'video' as any,
      file_size: file.size,
      processing_status: 'pending' as any,
    })
    .select()
    .single();

  if (materialError || !material) {
    throw new Error(`Failed to create material record: ${materialError?.message}`);
  }

  console.log(LOG_PREFIX, `[${elapsed()}] Material record created: ${material.id}`);

  onProgress({ stage: 'parsing', progress: 93, statusText: 'Starting transcription...' });

  // --- 3. Invoke transcribe-video edge function ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 3: Invoke transcribe-video`);

  const { data: result, error: invokeError } = await supabase.functions.invoke(
    'transcribe-video',
    {
      body: {
        materialId: material.id,
        audioUrl: uploadUrl,   // AssemblyAI upload URL — no signed URL needed
      },
    }
  );

  if (invokeError) {
    throw new Error(`Transcription failed: ${invokeError.message}`);
  }

  if (result?.error) {
    throw new Error(result.error);
  }

  console.log(LOG_PREFIX, `[${elapsed()}] Edge function returned:`, result);

  onProgress({
    stage: 'parsing',
    progress: 95,
    statusText: 'Transcribing in background...',
  });

  return { materialId: material.id };
}
