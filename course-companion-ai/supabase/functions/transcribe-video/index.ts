import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------- Request types ----------

interface SingleFileRequest {
  materialId: string;
  filePath: string;
  bucketName?: string;
}

interface ChunkMeta {
  filePath: string;
  index: number;
  offsetMs: number;
}

interface MultiChunkRequest {
  materialId: string;
  chunks: ChunkMeta[];
  totalChunks: number;
  currentChunkIndex?: number; // set on self-invocation
}

type TranscribeRequest = SingleFileRequest | MultiChunkRequest;

function isMultiChunkRequest(body: TranscribeRequest): body is MultiChunkRequest {
  return Array.isArray((body as MultiChunkRequest).chunks);
}

// ---------- Internal types ----------

interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number | null;
  speakerLabel?: string | null;
}

interface TranscriptionResult {
  durationMs: number | null;
  language: string | null;
  provider: string;
  segments: TranscriptSegment[];
}

interface TranscriptChunk {
  text: string;
  startMs: number;
  endMs: number;
}

// ---------- Constants ----------

const WHISPER_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const DEFAULT_BUCKET = "course-materials";
const DEFAULT_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";
const EMBEDDING_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
const TARGET_CHUNK_CHARACTERS = 1200;
const MIN_CHUNK_CHARACTERS = 200;
const SEGMENT_OVERLAP = 1;
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["mp3", "mp4", "webm", "m4a", "wav", "ogg"]);

// ---------- Helpers ----------

function formatFileSizeMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function getFileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() || "";
}

function getMimeTypeForFile(filePath: string): string {
  const ext = getFileExtension(filePath);
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    webm: "video/webm",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
  };
  return map[ext] || "application/octet-stream";
}

function normalizeTranscriptSegments(
  segments: unknown[],
  offsetMs = 0
): TranscriptSegment[] {
  const normalized = segments
    .map((segment) => {
      if (!segment || typeof segment !== "object") return null;

      const candidate = segment as Record<string, unknown>;
      const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
      const startSeconds = typeof candidate.start === "number" ? candidate.start : null;
      const endSeconds = typeof candidate.end === "number" ? candidate.end : null;

      if (!text || startSeconds === null || endSeconds === null) return null;

      const startMs = Math.max(0, Math.round(startSeconds * 1000) + offsetMs);
      const endMs = Math.max(startMs, Math.round(endSeconds * 1000) + offsetMs);

      return {
        startMs,
        endMs,
        text,
        confidence:
          typeof candidate.avg_logprob === "number" ? candidate.avg_logprob : null,
        speakerLabel: null,
      } satisfies TranscriptSegment;
    })
    .filter((s): s is TranscriptSegment => Boolean(s))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const deduped: TranscriptSegment[] = [];
  for (const segment of normalized) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.startMs === segment.startMs &&
      prev.endMs === segment.endMs &&
      prev.text === segment.text
    ) {
      continue;
    }
    if (prev && segment.startMs < prev.startMs) continue;
    deduped.push(segment);
  }

  return deduped;
}

function buildTranscriptChunks(segments: TranscriptSegment[]): TranscriptChunk[] {
  if (segments.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  let index = 0;

  while (index < segments.length) {
    const windowSegments: TranscriptSegment[] = [];
    let textLength = 0;
    let cursor = index;

    while (cursor < segments.length) {
      const segment = segments[cursor];
      const nextLength = textLength + (textLength > 0 ? 1 : 0) + segment.text.length;

      if (
        windowSegments.length > 0 &&
        nextLength > TARGET_CHUNK_CHARACTERS &&
        textLength >= MIN_CHUNK_CHARACTERS
      ) {
        break;
      }

      windowSegments.push(segment);
      textLength = nextLength;
      cursor += 1;

      if (textLength >= TARGET_CHUNK_CHARACTERS) break;
    }

    if (windowSegments.length === 0) break;

    const text = windowSegments.map((s) => s.text).join(" ").trim();
    if (text) {
      chunks.push({
        text,
        startMs: windowSegments[0].startMs,
        endMs: windowSegments[windowSegments.length - 1].endMs,
      });
    }

    if (cursor >= segments.length) break;
    index = Math.max(index + 1, cursor - SEGMENT_OVERLAP);
  }

  return chunks;
}

async function embedText(text: string, geminiApiKey: string): Promise<number[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(EMBEDDING_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 1536,
      }),
    });

    if (response.ok) {
      const payload = await response.json();
      const values = payload.embedding?.values;
      if (!Array.isArray(values)) {
        throw new Error("Embedding response did not include values");
      }
      return values as number[];
    }

    const errorText = await response.text();
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
  }

  throw new Error("Embedding API error: retries exhausted");
}

async function transcribeWithOpenAiCompatible(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  offsetMs?: number;
}): Promise<TranscriptionResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const apiUrl =
    Deno.env.get("OPENAI_TRANSCRIPTION_API_URL") || DEFAULT_TRANSCRIPTION_URL;
  const model =
    Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") || DEFAULT_TRANSCRIPTION_MODEL;

  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([input.bytes], { type: input.mimeType }),
    input.fileName
  );
  formData.append("model", model);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  let payload: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (response.ok) {
      payload = await response.json();
      break;
    }

    const errorText = await response.text();
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    throw new Error(
      `Transcription API error: ${response.status} - ${errorText || "Unknown error"}`
    );
  }

  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  const normalizedSegments = normalizeTranscriptSegments(
    segments,
    input.offsetMs ?? 0
  );

  if (normalizedSegments.length === 0) {
    throw new Error("The transcription service returned no timestamped segments");
  }

  return {
    durationMs:
      typeof payload.duration === "number"
        ? Math.round(payload.duration * 1000) + (input.offsetMs ?? 0)
        : normalizedSegments[normalizedSegments.length - 1]?.endMs ?? null,
    language: typeof payload.language === "string" ? payload.language : null,
    provider: "openai-whisper-compatible",
    segments: normalizedSegments,
  };
}

// ---------- Core processing: finalize (chunk + embed + store) ----------

async function finalizeTranscription(opts: {
  materialId: string;
  allSegments: TranscriptSegment[];
  durationMs: number | null;
  language: string | null;
  adminClient: any;
  geminiApiKey: string;
  chunkStoragePaths?: string[];
}) {
  const {
    materialId,
    allSegments,
    durationMs,
    language,
    adminClient,
    geminiApiKey,
    chunkStoragePaths,
  } = opts;

  const transcriptChunks = buildTranscriptChunks(allSegments);
  if (transcriptChunks.length === 0) {
    throw new Error("The transcript did not contain enough text to index");
  }

  await adminClient
    .from("materials")
    .update({
      processing_status: "processing",
      processing_stage: "chunking",
      processing_progress: 72,
    })
    .eq("id", materialId);

  // Clear previous data
  await adminClient.from("material_transcript_segments").delete().eq("material_id", materialId);
  await adminClient.from("chunks").delete().eq("material_id", materialId);

  // Insert transcript segments
  const transcriptRows = allSegments.map((segment, index) => ({
    material_id: materialId,
    segment_index: index,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    text: segment.text,
    confidence: segment.confidence ?? null,
    speaker_label: segment.speakerLabel ?? null,
  }));

  for (let i = 0; i < transcriptRows.length; i += 250) {
    const batch = transcriptRows.slice(i, i + 250);
    const { error } = await adminClient
      .from("material_transcript_segments")
      .insert(batch);
    if (error) throw new Error(`Failed to insert transcript segments: ${error.message}`);
  }

  // Generate embeddings
  await adminClient
    .from("materials")
    .update({
      processing_status: "processing",
      processing_stage: "embedding",
      processing_progress: 80,
    })
    .eq("id", materialId);

  const chunkRows: Array<{
    material_id: string;
    chunk_index: number;
    chunk_text: string;
    embedding: number[];
    start_position: number;
    end_position: number;
    start_ms: number;
    end_ms: number;
    page_number: null;
  }> = [];

  for (let i = 0; i < transcriptChunks.length; i += 1) {
    const chunk = transcriptChunks[i];
    const embedding = await embedText(chunk.text, geminiApiKey);
    chunkRows.push({
      material_id: materialId,
      chunk_index: i,
      chunk_text: chunk.text,
      embedding,
      start_position: 0,
      end_position: chunk.text.length,
      start_ms: chunk.startMs,
      end_ms: chunk.endMs,
      page_number: null,
    });
  }

  for (let i = 0; i < chunkRows.length; i += 100) {
    const batch = chunkRows.slice(i, i + 100);
    const { error } = await adminClient.from("chunks").insert(batch);
    if (error) throw new Error(`Failed to insert transcript chunks: ${error.message}`);
  }

  // Clean up audio chunks from storage
  if (chunkStoragePaths && chunkStoragePaths.length > 0) {
    await adminClient.storage
      .from(DEFAULT_BUCKET)
      .remove(chunkStoragePaths);
  }

  // Mark completed — clear file_path since original video is not stored
  await adminClient
    .from("materials")
    .update({
      processing_status: "completed",
      processing_error: null,
      processing_stage: "completed",
      processing_progress: 100,
      duration_ms: durationMs,
      transcription_provider: "openai-whisper-compatible",
      transcription_language: language,
      thumbnail_path: null,
      file_path: "",
    })
    .eq("id", materialId);

  return { segmentsInserted: transcriptRows.length, chunksInserted: chunkRows.length };
}

// ---------- Main handler ----------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let materialIdForError: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          error: "Embedding service is not configured. Please add GEMINI_API_KEY.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as TranscribeRequest;
    materialIdForError = body.materialId;

    if (!body.materialId) {
      return new Response(
        JSON.stringify({ error: "materialId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ===== Multi-chunk mode =====
    if (isMultiChunkRequest(body)) {
      const { materialId, chunks, totalChunks } = body;
      const currentChunkIndex = body.currentChunkIndex ?? 0;

      await adminClient
        .from("materials")
        .update({
          processing_status: "processing",
          processing_error: null,
          processing_stage: "transcribing",
          processing_progress: 35 + Math.round((currentChunkIndex / totalChunks) * 35),
        })
        .eq("id", materialId);

      // Transcribe the current chunk
      const chunkMeta = chunks[currentChunkIndex];
      const { data: fileData, error: downloadError } = await adminClient.storage
        .from(DEFAULT_BUCKET)
        .download(chunkMeta.filePath);

      if (downloadError || !fileData) {
        throw new Error(
          `Failed to download audio chunk ${currentChunkIndex}: ${downloadError?.message || "No data"}`
        );
      }

      const fileBytes = new Uint8Array(await fileData.arrayBuffer());
      if (fileBytes.length > WHISPER_MAX_FILE_SIZE_BYTES) {
        throw new Error(
          `Audio chunk ${currentChunkIndex} (${formatFileSizeMb(fileBytes.length)}) exceeds the 25MB Whisper limit.`
        );
      }

      const mimeType = getMimeTypeForFile(chunkMeta.filePath);
      const transcription = await transcribeWithOpenAiCompatible({
        bytes: fileBytes,
        fileName: chunkMeta.filePath.split("/").pop() || `chunk_${currentChunkIndex}.mp3`,
        mimeType,
        offsetMs: chunkMeta.offsetMs,
      });

      // Store this chunk's segments immediately
      const segmentRows = transcription.segments.map((seg, i) => ({
        material_id: materialId,
        segment_index: currentChunkIndex * 10000 + i, // offset to avoid index collision across chunks
        start_ms: seg.startMs,
        end_ms: seg.endMs,
        text: seg.text,
        confidence: seg.confidence ?? null,
        speaker_label: seg.speakerLabel ?? null,
      }));

      for (let i = 0; i < segmentRows.length; i += 250) {
        const batch = segmentRows.slice(i, i + 250);
        const { error } = await adminClient
          .from("material_transcript_segments")
          .insert(batch);
        if (error) throw new Error(`Failed to insert transcript segments: ${error.message}`);
      }

      const nextIndex = currentChunkIndex + 1;

      if (nextIndex < totalChunks) {
        // More chunks to process — self-invoke for the next chunk
        await adminClient
          .from("materials")
          .update({
            processing_progress: 35 + Math.round((nextIndex / totalChunks) * 35),
          })
          .eq("id", materialId);

        // Fire-and-forget self-invocation
        const selfInvokeBody: MultiChunkRequest = {
          materialId,
          chunks,
          totalChunks,
          currentChunkIndex: nextIndex,
        };

        // Use EdgeRuntime.waitUntil to not block the response
        const selfInvokePromise = fetch(
          `${supabaseUrl}/functions/v1/transcribe-video`,
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(selfInvokeBody),
          }
        ).catch((err) => console.error("Self-invoke failed:", err));

        // @ts-ignore — Deno EdgeRuntime global
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(selfInvokePromise);
        } else {
          // Fallback: await it (will block response but still works)
          await selfInvokePromise;
        }

        return new Response(
          JSON.stringify({
            success: true,
            status: "processing",
            processedChunk: currentChunkIndex,
            nextChunk: nextIndex,
            totalChunks,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // All chunks transcribed — now read all segments back, build chunks, embed
      const { data: allSegmentRows, error: segFetchError } = await adminClient
        .from("material_transcript_segments")
        .select("start_ms, end_ms, text, confidence, speaker_label")
        .eq("material_id", materialId)
        .order("start_ms", { ascending: true });

      if (segFetchError) {
        throw new Error(`Failed to fetch accumulated segments: ${segFetchError.message}`);
      }

      const allSegments: TranscriptSegment[] = (allSegmentRows || []).map((row: any) => ({
        startMs: row.start_ms,
        endMs: row.end_ms,
        text: row.text,
        confidence: row.confidence,
        speakerLabel: row.speaker_label,
      }));

      // Clear segments (will be re-inserted with proper indices by finalizeTranscription)
      await adminClient.from("material_transcript_segments").delete().eq("material_id", materialId);

      const chunkStoragePaths = chunks.map((c) => c.filePath);
      const maxDurationMs = allSegments.length > 0
        ? allSegments[allSegments.length - 1].endMs
        : transcription.durationMs;

      const result = await finalizeTranscription({
        materialId,
        allSegments,
        durationMs: maxDurationMs,
        language: transcription.language,
        adminClient,
        geminiApiKey,
        chunkStoragePaths,
      });

      return new Response(
        JSON.stringify({
          success: true,
          provider: "openai-whisper-compatible",
          language: transcription.language,
          durationMs: maxDurationMs,
          segmentsInserted: result.segmentsInserted,
          chunksInserted: result.chunksInserted,
          totalChunksProcessed: totalChunks,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== Single-file mode (original behavior) =====
    const { filePath, bucketName } = body as SingleFileRequest;

    if (!filePath) {
      return new Response(
        JSON.stringify({ error: "filePath is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const extension = getFileExtension(filePath);
    if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported file type: ${extension || "unknown"}`);
    }

    await adminClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_error: null,
        processing_stage: "transcribing",
        processing_progress: 25,
      })
      .eq("id", body.materialId);

    const { data: fileData, error: downloadError } = await adminClient.storage
      .from(bucketName || DEFAULT_BUCKET)
      .download(filePath);

    if (downloadError || !fileData) {
      throw new Error(
        `Failed to download file: ${downloadError?.message || "No data"}`
      );
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    if (fileBytes.length > WHISPER_MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File size (${formatFileSizeMb(fileBytes.length)}) exceeds the 25MB transcription limit.`
      );
    }

    const mimeType = getMimeTypeForFile(filePath);

    const transcription = await transcribeWithOpenAiCompatible({
      bytes: fileBytes,
      fileName: filePath.split("/").pop() || `upload.${extension}`,
      mimeType,
    });

    const result = await finalizeTranscription({
      materialId: body.materialId,
      allSegments: transcription.segments,
      durationMs: transcription.durationMs,
      language: transcription.language,
      adminClient,
      geminiApiKey,
      chunkStoragePaths: [filePath], // clean up the single audio file too
    });

    return new Response(
      JSON.stringify({
        success: true,
        provider: transcription.provider,
        language: transcription.language,
        durationMs: transcription.durationMs,
        segmentsInserted: result.segmentsInserted,
        chunksInserted: result.chunksInserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("Transcribe video error:", error);

    if (materialIdForError) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, serviceRoleKey);
        await adminClient
          .from("materials")
          .update({
            processing_status: "failed",
            processing_error: message,
            processing_stage: "failed",
            processing_progress: null,
          })
          .eq("id", materialIdForError);
      } catch (updateError) {
        console.error("Failed to update material error state:", updateError);
      }
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
