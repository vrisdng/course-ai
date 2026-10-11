import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { createOpenAIEmbeddingService } from "../_shared/llm.ts";
import { AssemblyAIWord, buildTranscriptChunks, groupWordsIntoSegments, TranscriptSegment } from "./pipeline.ts";

type AdminClient = ReturnType<typeof createClient>;
const ASSEMBLYAI_API_URL = "https://api.assemblyai.com/v2";
const EMBED_BATCH_SIZE = 50;
const SEGMENTS_PER_RUN = 1000;
const CHUNKS_PER_RUN = 500;

interface ProviderTranscript {
  status: string;
  words?: AssemblyAIWord[];
  audio_duration?: number;
  language_code?: string;
  error?: string;
}

interface VideoJob {
  material_id: string;
  status: string;
  provider_transcript_id: string | null;
  attempt_count: number;
  duration_ms: number | null;
  language: string | null;
  stage_source: "provider" | "existing";
  stage_segment_cursor: number;
  stage_chunk_cursor: number;
}

async function updateJob(admin: AdminClient, materialId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("video_transcription_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("material_id", materialId);
  if (error) throw new Error(error.message);
}

export async function fetchProviderTranscript(id: string, apiKey: string): Promise<ProviderTranscript> {
  const response = await fetch(`${ASSEMBLYAI_API_URL}/transcript/${encodeURIComponent(id)}`, {
    headers: { Authorization: apiKey },
  });
  if (!response.ok) throw new Error(`AssemblyAI status request failed (${response.status})`);
  return await response.json() as ProviderTranscript;
}

async function loadExistingSegments(admin: AdminClient, materialId: string): Promise<TranscriptSegment[]> {
  const segments: TranscriptSegment[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin.from("material_transcript_segments")
      .select("start_ms,end_ms,text,confidence,speaker_label")
      .eq("material_id", materialId).order("segment_index").range(offset, offset + 499);
    if (error) throw new Error(error.message);
    segments.push(...(data ?? []).map((row) => ({
      startMs: row.start_ms, endMs: row.end_ms, text: row.text,
      confidence: row.confidence, speakerLabel: row.speaker_label,
    })));
    if (!data || data.length < 500) break;
  }
  return segments;
}

async function stageTranscriptBatch(
  admin: AdminClient, job: VideoJob, segments: TranscriptSegment[],
  durationMs: number | null, language: string | null,
): Promise<string> {
  const materialId = job.material_id;
  const chunks = buildTranscriptChunks(segments);
  if (!segments.length || !chunks.length) throw new Error("Transcript has no usable speech");
  if (job.stage_segment_cursor === 0 && job.stage_chunk_cursor === 0) {
    const { error: clearSegmentsError } = await admin.from("video_transcript_segments_staging").delete().eq("material_id", materialId);
    if (clearSegmentsError) throw new Error(clearSegmentsError.message);
    const { error: clearChunksError } = await admin.from("video_chunks_staging").delete().eq("material_id", materialId);
    if (clearChunksError) throw new Error(clearChunksError.message);
  }

  const segmentEnd = Math.min(job.stage_segment_cursor + SEGMENTS_PER_RUN, segments.length);
  const chunkEnd = Math.min(job.stage_chunk_cursor + CHUNKS_PER_RUN, chunks.length);
  for (let i = job.stage_segment_cursor; i < segmentEnd; i += 200) {
    const rows = segments.slice(i, Math.min(i + 200, segmentEnd)).map((segment, offset) => ({
      material_id: materialId, segment_index: i + offset, start_ms: segment.startMs,
      end_ms: segment.endMs, text: segment.text, confidence: segment.confidence ?? null,
      speaker_label: segment.speakerLabel ?? null,
    }));
    const { error } = await admin.from("video_transcript_segments_staging")
      .upsert(rows, { onConflict: "material_id,segment_index" });
    if (error) throw new Error(error.message);
  }
  for (let i = job.stage_chunk_cursor; i < chunkEnd; i += 100) {
    const rows = chunks.slice(i, Math.min(i + 100, chunkEnd)).map((chunk, offset) => ({
      material_id: materialId, chunk_index: i + offset,
      chunk_text: chunk.text, start_ms: chunk.startMs, end_ms: chunk.endMs,
    }));
    const { error } = await admin.from("video_chunks_staging")
      .upsert(rows, { onConflict: "material_id,chunk_index" });
    if (error) throw new Error(error.message);
  }
  const finished = segmentEnd === segments.length && chunkEnd === chunks.length;
  await updateJob(admin, materialId, {
    status: finished ? "indexing" : "staging", duration_ms: durationMs, language,
    stage_segment_cursor: segmentEnd, stage_chunk_cursor: chunkEnd,
    locked_until: null, next_check_at: new Date().toISOString(), last_error: null,
  });
  const { error } = await admin.from("materials").update({
    processing_status: "processing", processing_stage: finished ? "embedding" : "chunking", processing_progress: finished ? 70 : 65,
  }).eq("id", materialId);
  if (error) throw new Error(error.message);
  return finished ? "indexing" : "staging";
}

async function processIndexBatch(admin: AdminClient, job: VideoJob, openAiApiKey: string): Promise<string> {
  const { data: rows, error } = await admin.from("video_chunks_staging")
    .select("chunk_index,chunk_text,start_ms,end_ms")
    .eq("material_id", job.material_id).is("embedding_openai", null)
    .order("chunk_index").limit(EMBED_BATCH_SIZE);
  if (error) throw new Error(error.message);
  if (rows?.length) {
    const vectors = await createOpenAIEmbeddingService(openAiApiKey).embedDocuments(rows.map((row) => row.chunk_text));
    const updates = rows.map((row, index) => ({ ...row, material_id: job.material_id, embedding_openai: vectors[index] }));
    const { error: updateError } = await admin.from("video_chunks_staging")
      .upsert(updates, { onConflict: "material_id,chunk_index" });
    if (updateError) throw new Error(updateError.message);
    await updateJob(admin, job.material_id, {
      locked_until: null, next_check_at: new Date().toISOString(), last_error: null,
    });
    return "indexing";
  }

  const { error: publishError } = await admin.rpc("publish_video_transcript", {
    p_material_id: job.material_id, p_duration_ms: job.duration_ms, p_language: job.language,
  });
  if (publishError) throw new Error(publishError.message);
  return "completed";
}

export async function processDueVideoJob(admin: AdminClient, assemblyApiKey: string, openAiApiKey: string): Promise<{ materialId: string; status: string } | null> {
  const { data, error } = await admin.rpc("claim_due_video_transcription_job");
  if (error) throw new Error(error.message);
  const job = (data as VideoJob[] | null)?.[0];
  if (!job) return null;

  const { data: material, error: materialError } = await admin.from("materials")
    .select("video_upload_state,file_path").eq("id", job.material_id).maybeSingle();
  if (materialError) throw new Error(materialError.message);
  const legacyIndexOnly = (job.status === "indexing" || job.status === "staging") &&
    job.stage_source === "existing" && material?.video_upload_state == null && !material?.file_path;
  if (!material || (material.video_upload_state !== "uploaded" && !legacyIndexOnly)) {
    await updateJob(admin, job.material_id, {
      status: "failed", last_error: "Video was removed before transcription completed", locked_until: null,
    });
    return { materialId: job.material_id, status: "cancelled" };
  }

  try {
    if (job.status === "indexing") {
      return { materialId: job.material_id, status: await processIndexBatch(admin, job, openAiApiKey) };
    }
    if (job.status === "staging") {
      let segments: TranscriptSegment[];
      let durationMs = job.duration_ms;
      let language = job.language;
      if (job.stage_source === "existing") {
        segments = await loadExistingSegments(admin, job.material_id);
      } else {
        if (!job.provider_transcript_id) throw new Error("Missing provider transcript ID");
        const transcript = await fetchProviderTranscript(job.provider_transcript_id, assemblyApiKey);
        if (transcript.status !== "completed") throw new Error("Completed provider transcript is unavailable");
        segments = groupWordsIntoSegments(transcript.words ?? []);
        durationMs = typeof transcript.audio_duration === "number" ? Math.round(transcript.audio_duration * 1000) : null;
        language = transcript.language_code ?? null;
      }
      return { materialId: job.material_id, status: await stageTranscriptBatch(admin, job, segments, durationMs, language) };
    }
    if (!job.provider_transcript_id) throw new Error("Missing provider transcript ID");
    const transcript = await fetchProviderTranscript(job.provider_transcript_id, assemblyApiKey);
    if (transcript.status === "error") {
      const providerError = transcript.error || "Unknown error";
      const durationLimit = /duration|too long|10\s*(?:hour|hr)/i.test(providerError);
      throw new Error(durationLimit
        ? `AssemblyAI transcription failed: video exceeds the provider duration limit (10 hours). Stored video remains playable. ${providerError}`
        : `AssemblyAI transcription failed: ${providerError}`);
    }
    if (transcript.status !== "completed") {
      await updateJob(admin, job.material_id, {
        locked_until: null, next_check_at: new Date(Date.now() + 60_000).toISOString(),
      });
      return { materialId: job.material_id, status: "waiting" };
    }
    await updateJob(admin, job.material_id, {
      status: "staging", stage_source: "provider", stage_segment_cursor: 0, stage_chunk_cursor: 0,
      duration_ms: typeof transcript.audio_duration === "number" ? Math.round(transcript.audio_duration * 1000) : null,
      language: transcript.language_code ?? null,
      locked_until: null, next_check_at: new Date().toISOString(), last_error: null,
    });
    return { materialId: job.material_id, status: "staging" };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unexpected processing error";
    const terminal = message.startsWith("AssemblyAI transcription failed:") ||
      message === "Transcript has no usable speech" ||
      message === "Completed provider transcript is unavailable" ||
      message === "AssemblyAI status request failed (404)";
    const nextAttempt = job.attempt_count + 1;
    const failed = terminal || nextAttempt >= 8;
    await updateJob(admin, job.material_id, {
      status: failed ? "failed" : job.status,
      retry_status: terminal ? "pending" : job.status,
      attempt_count: nextAttempt, last_error: message, locked_until: null,
      next_check_at: new Date(Date.now() + Math.min(2 ** Math.min(nextAttempt, 6), 60) * 60_000).toISOString(),
    });
    if (failed) await admin.from("materials").update({
      processing_status: "failed", processing_stage: "failed", processing_error: message,
      processing_progress: null,
    }).eq("id", job.material_id);
    return { materialId: job.material_id, status: failed ? "failed" : "retrying" };
  }
}
