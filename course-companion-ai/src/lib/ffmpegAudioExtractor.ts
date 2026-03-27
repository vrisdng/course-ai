import type { FFmpeg } from '@ffmpeg/ffmpeg';

export interface AudioChunk {
  blob: Blob;
  index: number;
  totalChunks: number;
  offsetMs: number;
  fileName: string;
}

type ProgressCallback = (fraction: number) => void;

const AUDIO_BITRATE_KBPS = 64;
const AUDIO_BYTES_PER_SECOND = (AUDIO_BITRATE_KBPS * 1024) / 8; // 8192 bytes/s
const MAX_CHUNK_BYTES = 20 * 1024 * 1024; // 20MB per chunk
const OVERLAP_SECONDS = 1;
const LOG_PREFIX = '[ffmpeg-extractor]';

let cachedFFmpeg: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (cachedFFmpeg?.loaded) {
    console.log(LOG_PREFIX, 'Reusing cached FFmpeg instance');
    return cachedFFmpeg;
  }

  console.log(LOG_PREFIX, 'Loading FFmpeg WASM (first time may download ~30MB)...');
  const t0 = performance.now();

  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();

  await ffmpeg.load({
    coreURL: '/ffmpeg/ffmpeg-core.js',
    wasmURL: '/ffmpeg/ffmpeg-core.wasm',
  });

  console.log(LOG_PREFIX, `FFmpeg WASM loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  cachedFFmpeg = ffmpeg;
  return ffmpeg;
}

function resetCachedFFmpeg() {
  cachedFFmpeg = null;
}

/** Eagerly load FFmpeg WASM in the background so it's ready when needed. */
export function preloadFFmpeg(): void {
  getFFmpeg().catch((err) => {
    console.warn(LOG_PREFIX, 'Preload failed (will retry on demand):', err);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function getAudioDuration(ffmpeg: FFmpeg, inputName: string): Promise<number> {
  let durationSeconds = 0;

  const handler = ({ message }: { message: string }) => {
    const match = message.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (match) {
      const [, h, m, s, cs] = match;
      durationSeconds =
        parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(cs) / 100;
    }
  };

  ffmpeg.on('log', handler);

  try {
    await ffmpeg.exec(['-i', inputName, '-f', 'null', '-']);
  } catch {
    // ffmpeg returns non-zero for -f null, but logs are captured
  }

  ffmpeg.off('log', handler);
  console.log(LOG_PREFIX, `Audio duration: ${durationSeconds.toFixed(1)}s`);
  return durationSeconds;
}

export async function extractAndSplitAudio(
  file: File,
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<AudioChunk[]> {
  const t0 = performance.now();
  const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

  const report = (fraction: number) => onProgress?.(Math.min(1, Math.max(0, fraction)));

  const checkCancelled = () => {
    if (signal?.aborted) throw new Error('Upload cancelled');
  };

  console.log(LOG_PREFIX, `Starting extraction for "${file.name}" (${formatBytes(file.size)})`);
  report(0);
  checkCancelled();

  const ffmpeg = await getFFmpeg();

  // If signal aborts while FFmpeg is running, terminate it
  const onAbort = () => {
    console.log(LOG_PREFIX, 'Abort signal received — terminating FFmpeg');
    ffmpeg.terminate();
    resetCachedFFmpeg();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    report(0.05);

    // Write video file to virtual FS
    console.log(LOG_PREFIX, `[${elapsed()}] Writing video to FFmpeg virtual FS...`);
    const { fetchFile } = await import('@ffmpeg/util');
    const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    console.log(LOG_PREFIX, `[${elapsed()}] Video written to virtual FS`);
    report(0.15);
    checkCancelled();

    // Extract audio as mono MP3 at 64kbps, 16kHz (optimal for speech)
    const outputName = 'audio.mp3';
    console.log(LOG_PREFIX, `[${elapsed()}] Extracting audio (64kbps mono MP3)... this may take a while for large files`);
    await ffmpeg.exec([
      '-i', inputName,
      '-vn',           // no video
      '-ac', '1',      // mono
      '-ar', '16000',  // 16kHz sample rate
      '-ab', `${AUDIO_BITRATE_KBPS}k`,
      '-f', 'mp3',
      outputName,
    ]);
    console.log(LOG_PREFIX, `[${elapsed()}] Audio extraction complete`);
    report(0.6);
    checkCancelled();

    // Clean up input to free memory
    await ffmpeg.deleteFile(inputName);
    console.log(LOG_PREFIX, `[${elapsed()}] Input file deleted from virtual FS (freed memory)`);

    // Read extracted audio
    const audioData = await ffmpeg.readFile(outputName) as Uint8Array;
    const audioBytes = audioData.length;
    console.log(LOG_PREFIX, `[${elapsed()}] Extracted audio size: ${formatBytes(audioBytes)}`);

    if (audioBytes <= MAX_CHUNK_BYTES) {
      await ffmpeg.deleteFile(outputName);
      console.log(LOG_PREFIX, `[${elapsed()}] Single chunk (under ${formatBytes(MAX_CHUNK_BYTES)}), no splitting needed`);
      report(1);
      return [
        {
          blob: new Blob([audioData], { type: 'audio/mpeg' }),
          index: 0,
          totalChunks: 1,
          offsetMs: 0,
          fileName: 'chunk_0.mp3',
        },
      ];
    }

    // Need to split — calculate chunk duration
    console.log(LOG_PREFIX, `[${elapsed()}] Audio exceeds ${formatBytes(MAX_CHUNK_BYTES)}, splitting...`);
    const totalDurationSeconds = await getAudioDuration(ffmpeg, outputName);
    const chunkDurationSeconds = Math.floor(MAX_CHUNK_BYTES / AUDIO_BYTES_PER_SECOND);
    const totalChunks = Math.ceil(totalDurationSeconds / chunkDurationSeconds);
    console.log(LOG_PREFIX, `[${elapsed()}] Will split into ${totalChunks} chunks (~${Math.round(chunkDurationSeconds / 60)}min each)`);

    const chunks: AudioChunk[] = [];

    for (let i = 0; i < totalChunks; i++) {
      checkCancelled();

      const startSeconds = i === 0 ? 0 : i * chunkDurationSeconds - OVERLAP_SECONDS;
      const chunkFileName = `chunk_${i}.mp3`;

      console.log(LOG_PREFIX, `[${elapsed()}] Splitting chunk ${i + 1}/${totalChunks} (start=${startSeconds}s)...`);
      await ffmpeg.exec([
        '-i', outputName,
        '-ss', String(startSeconds),
        '-t', String(chunkDurationSeconds + (i === 0 ? 0 : OVERLAP_SECONDS)),
        '-c', 'copy',
        chunkFileName,
      ]);

      const chunkData = await ffmpeg.readFile(chunkFileName) as Uint8Array;
      await ffmpeg.deleteFile(chunkFileName);
      console.log(LOG_PREFIX, `[${elapsed()}] Chunk ${i + 1}/${totalChunks}: ${formatBytes(chunkData.length)}`);

      chunks.push({
        blob: new Blob([chunkData], { type: 'audio/mpeg' }),
        index: i,
        totalChunks,
        offsetMs: startSeconds * 1000,
        fileName: chunkFileName,
      });

      report(0.6 + ((i + 1) / totalChunks) * 0.4);
    }

    await ffmpeg.deleteFile(outputName);
    console.log(LOG_PREFIX, `[${elapsed()}] Splitting complete — ${totalChunks} chunks ready`);
    report(1);

    return chunks;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
