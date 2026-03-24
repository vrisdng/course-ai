import { supabase } from '@/integrations/supabase/client';
import { extractAndSplitAudio, type AudioChunk } from './ffmpegAudioExtractor';

export interface VideoUploadProgress {
  stage: 'extracting' | 'uploading' | 'parsing' | 'embedding' | 'done' | 'error';
  progress: number;
  statusText: string;
}

const LARGE_FILE_THRESHOLD_BYTES = 200 * 1024 * 1024; // 200MB
const LOG_PREFIX = '[video-pipeline]';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function uploadVideoForTranscription(opts: {
  file: File;
  courseId: string;
  onProgress: (update: VideoUploadProgress) => void;
  confirmLargeFile?: () => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<{ materialId: string }> {
  const { file, courseId, onProgress, confirmLargeFile, signal } = opts;
  const t0 = performance.now();
  const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

  const checkCancelled = () => {
    if (signal?.aborted) throw new Error('Upload cancelled');
  };

  console.log(LOG_PREFIX, `Starting video upload pipeline for "${file.name}" (${formatBytes(file.size)})`);

  // --- Large file confirmation ---
  if (file.size > LARGE_FILE_THRESHOLD_BYTES && confirmLargeFile) {
    const ok = await confirmLargeFile();
    if (!ok) throw new Error('Upload cancelled by user');
  }

  // --- 1. Extract audio ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 1: Extract audio`);
  onProgress({
    stage: 'extracting',
    progress: 5,
    statusText: 'Preparing video processor...',
  });

  checkCancelled();

  let chunks: AudioChunk[];
  try {
    chunks = await extractAndSplitAudio(
      file,
      (fraction) => {
        onProgress({
          stage: 'extracting',
          progress: 5 + Math.round(fraction * 15), // 5–20%
          statusText:
            fraction < 0.15
              ? 'Loading video processor...'
              : fraction < 0.6
                ? 'Extracting audio from video...'
                : 'Splitting audio into chunks...',
        });
      },
      signal
    );
  } catch (err) {
    console.error(LOG_PREFIX, `[${elapsed()}] Audio extraction failed:`, err);
    throw new Error(
      `Audio extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }

  console.log(LOG_PREFIX, `[${elapsed()}] Audio extraction done — ${chunks.length} chunk(s), sizes: [${chunks.map(c => formatBytes(c.blob.size)).join(', ')}]`);

  checkCancelled();

  // --- 2. Create material record first (we need the ID for storage paths) ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 2: Create material record`);
  const timestamp = Date.now();
  const basePath = `${courseId}/audio-chunks/${timestamp}-${file.name}`;

  const { data: material, error: materialError } = await supabase
    .from('materials')
    .insert({
      course_id: courseId,
      file_name: file.name,
      file_path: basePath,
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

  // --- 3. Upload audio chunks ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 3: Upload ${chunks.length} audio chunk(s) to storage`);
  const chunkMeta: Array<{ filePath: string; index: number; offsetMs: number }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const storagePath = `${basePath}/${chunk.fileName}`;

    onProgress({
      stage: 'uploading',
      progress: 20 + Math.round(((i + 0.5) / chunks.length) * 15), // 20–35%
      statusText:
        chunks.length === 1
          ? `Uploading audio (${formatBytes(chunk.blob.size)})...`
          : `Uploading audio chunk ${i + 1} of ${chunks.length} (${formatBytes(chunk.blob.size)})...`,
    });

    console.log(LOG_PREFIX, `[${elapsed()}] Uploading chunk ${i + 1}/${chunks.length} (${formatBytes(chunk.blob.size)}) to ${storagePath}`);
    const uploadStart = performance.now();

    const { error: uploadError } = await supabase.storage
      .from('course-materials')
      .upload(storagePath, chunk.blob, { contentType: 'audio/mpeg' });

    if (uploadError) {
      console.error(LOG_PREFIX, `[${elapsed()}] Chunk ${i + 1} upload failed:`, uploadError);
      throw new Error(`Failed to upload audio chunk ${i + 1}: ${uploadError.message}`);
    }

    console.log(LOG_PREFIX, `[${elapsed()}] Chunk ${i + 1} uploaded in ${((performance.now() - uploadStart) / 1000).toFixed(1)}s`);

    checkCancelled();

    chunkMeta.push({
      filePath: storagePath,
      index: chunk.index,
      offsetMs: chunk.offsetMs,
    });
  }

  // --- 4. Invoke transcribe-video edge function ---
  console.log(LOG_PREFIX, `[${elapsed()}] Step 4: Invoke transcribe-video edge function`);
  onProgress({
    stage: 'parsing',
    progress: 35,
    statusText: 'Starting transcription...',
  });

  const requestBody =
    chunks.length === 1
      ? {
          materialId: material.id,
          filePath: chunkMeta[0].filePath,
          bucketName: 'course-materials',
        }
      : {
          materialId: material.id,
          chunks: chunkMeta,
          totalChunks: chunks.length,
        };

  console.log(LOG_PREFIX, `[${elapsed()}] Calling edge function with`, chunks.length === 1 ? 'single-file mode' : `multi-chunk mode (${chunks.length} chunks)`);

  const { data: result, error: invokeError } = await supabase.functions.invoke(
    'transcribe-video',
    { body: requestBody }
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

  // For multi-chunk, the function will self-invoke for remaining chunks.
  // The client polls via the existing 5s interval on processing_status.
  const isDone = chunks.length === 1 && !result?.queued;

  onProgress({
    stage: isDone ? 'done' : 'parsing',
    progress: isDone ? 100 : 40,
    statusText: isDone
      ? 'Ready for student questions'
      : 'Transcribing in background...',
  });

  console.log(LOG_PREFIX, `[${elapsed()}] Pipeline complete — materialId=${material.id}, status=${isDone ? 'done' : 'processing in background'}`);

  return { materialId: material.id };
}
