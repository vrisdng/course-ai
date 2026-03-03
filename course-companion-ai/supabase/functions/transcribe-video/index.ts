import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TranscribeVideoRequest {
  materialId: string;
  filePath: string;
  bucketName?: string;
}

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

const VIDEO_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const DEFAULT_BUCKET = "course-materials";
const DEFAULT_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";
const EMBEDDING_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
const TARGET_CHUNK_CHARACTERS = 1200;
const MIN_CHUNK_CHARACTERS = 200;
const SEGMENT_OVERLAP = 1;
const SUPPORTED_VIDEO_EXTENSIONS = new Set(["mp4", "webm"]);
const SUPPORTED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

function formatFileSizeMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function getFileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() || "";
}

function getMimeType(filePath: string, blobType: string): string {
  if (SUPPORTED_VIDEO_MIME_TYPES.has(blobType)) {
    return blobType;
  }

  const extension = getFileExtension(filePath);
  if (extension === "mp4") {
    return "video/mp4";
  }

  if (extension === "webm") {
    return "video/webm";
  }

  return blobType || "application/octet-stream";
}

function normalizeTranscriptSegments(segments: unknown[]): TranscriptSegment[] {
  const normalized = segments
    .map((segment) => {
      if (!segment || typeof segment !== "object") {
        return null;
      }

      const candidate = segment as Record<string, unknown>;
      const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
      const startSeconds = typeof candidate.start === "number" ? candidate.start : null;
      const endSeconds = typeof candidate.end === "number" ? candidate.end : null;

      if (!text || startSeconds === null || endSeconds === null) {
        return null;
      }

      const startMs = Math.max(0, Math.round(startSeconds * 1000));
      const endMs = Math.max(startMs, Math.round(endSeconds * 1000));

      return {
        startMs,
        endMs,
        text,
        confidence:
          typeof candidate.avg_logprob === "number" ? candidate.avg_logprob : null,
        speakerLabel: null,
      } satisfies TranscriptSegment;
    })
    .filter((segment): segment is TranscriptSegment => Boolean(segment))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const deduped: TranscriptSegment[] = [];
  for (const segment of normalized) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      previous.startMs === segment.startMs &&
      previous.endMs === segment.endMs &&
      previous.text === segment.text
    ) {
      continue;
    }

    if (previous && segment.startMs < previous.startMs) {
      continue;
    }

    deduped.push(segment);
  }

  return deduped;
}

function buildTranscriptChunks(segments: TranscriptSegment[]): TranscriptChunk[] {
  if (segments.length === 0) {
    return [];
  }

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

      if (textLength >= TARGET_CHUNK_CHARACTERS) {
        break;
      }
    }

    if (windowSegments.length === 0) {
      break;
    }

    const text = windowSegments.map((segment) => segment.text).join(" ").trim();
    if (text) {
      chunks.push({
        text,
        startMs: windowSegments[0].startMs,
        endMs: windowSegments[windowSegments.length - 1].endMs,
      });
    }

    if (cursor >= segments.length) {
      break;
    }

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
}): Promise<TranscriptionResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const apiUrl =
    Deno.env.get("OPENAI_TRANSCRIPTION_API_URL") || DEFAULT_TRANSCRIPTION_URL;
  const model =
    Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") || DEFAULT_TRANSCRIPTION_MODEL;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const formData = new FormData();
  formData.append("file", new Blob([input.bytes], { type: input.mimeType }), input.fileName);
  formData.append("model", model);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  let payload: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
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
  const normalizedSegments = normalizeTranscriptSegments(segments);

  if (normalizedSegments.length === 0) {
    throw new Error("The transcription service returned no timestamped segments");
  }

  return {
    durationMs:
      typeof payload.duration === "number"
        ? Math.round(payload.duration * 1000)
        : normalizedSegments[normalizedSegments.length - 1]?.endMs ?? null,
    language: typeof payload.language === "string" ? payload.language : null,
    provider: "openai-whisper-compatible",
    segments: normalizedSegments,
  };
}

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

    if (profileError || !profile || !["admin", "lecturer"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { materialId, filePath, bucketName } =
      (await req.json()) as TranscribeVideoRequest;
    materialIdForError = materialId;

    if (!materialId || !filePath) {
      return new Response(
        JSON.stringify({ error: "materialId and filePath are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const extension = getFileExtension(filePath);
    if (!SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported video type: ${extension || "unknown"}`);
    }

    await adminClient
      .from("materials")
      .update({ processing_status: "processing", processing_error: null })
      .eq("id", materialId);

    const { data: fileData, error: downloadError } = await adminClient.storage
      .from(bucketName || DEFAULT_BUCKET)
      .download(filePath);

    if (downloadError || !fileData) {
      throw new Error(
        `Failed to download video: ${downloadError?.message || "No data"}`
      );
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    if (fileBytes.length > VIDEO_MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File size (${formatFileSizeMb(fileBytes.length)}) exceeds the 25MB transcription limit for MP4 and WebM uploads.`
      );
    }

    const mimeType = getMimeType(filePath, fileData.type);
    if (!SUPPORTED_VIDEO_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported video MIME type: ${mimeType}`);
    }

    const transcription = await transcribeWithOpenAiCompatible({
      bytes: fileBytes,
      fileName: filePath.split("/").pop() || `upload.${extension}`,
      mimeType,
    });

    const transcriptChunks = buildTranscriptChunks(transcription.segments);
    if (transcriptChunks.length === 0) {
      throw new Error("The transcript did not contain enough text to index");
    }

    await adminClient.from("material_transcript_segments").delete().eq("material_id", materialId);
    await adminClient.from("chunks").delete().eq("material_id", materialId);

    const transcriptRows = transcription.segments.map((segment, index) => ({
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

      if (error) {
        throw new Error(`Failed to insert transcript segments: ${error.message}`);
      }
    }

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
      if (error) {
        throw new Error(`Failed to insert transcript chunks: ${error.message}`);
      }
    }

    await adminClient
      .from("materials")
      .update({
        processing_status: "completed",
        processing_error: null,
        duration_ms: transcription.durationMs,
        transcription_provider: transcription.provider,
        transcription_language: transcription.language,
        thumbnail_path: null,
      })
      .eq("id", materialId);

    return new Response(
      JSON.stringify({
        success: true,
        provider: transcription.provider,
        language: transcription.language,
        durationMs: transcription.durationMs,
        segmentsInserted: transcriptRows.length,
        chunksInserted: chunkRows.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
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
          .update({ processing_status: "failed", processing_error: message })
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
