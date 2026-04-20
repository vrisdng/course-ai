import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------- Request types ----------

interface TranscribeRequest {
  materialId: string;
  audioUrl: string; // AssemblyAI upload URL returned by upload-video function
}

interface RefinalizeRequest {
  materialId: string;
  refinalize: true; // Re-run chunking + embedding from existing transcript segments
}

// ---------- Internal types ----------

interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number | null;
  speakerLabel?: string | null;
}

interface TranscriptChunk {
  text: string;
  startMs: number;
  endMs: number;
}

interface AssemblyAIWord {
  text: string;
  start: number; // ms
  end: number;   // ms
  confidence: number;
  speaker?: string | null;
}

// ---------- Constants ----------

const ASSEMBLYAI_API_URL = "https://api.assemblyai.com/v2";
const ASSEMBLYAI_POLL_INTERVAL_MS = 5000;
const EMBEDDING_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
const TARGET_CHUNK_CHARACTERS = 1200;
const MIN_CHUNK_CHARACTERS = 200;
const SEGMENT_OVERLAP = 1;
const PARAGRAPH_DURATION_MS = 60_000; // target ~1 minute per paragraph
const SENTENCE_ENDERS = new Set([".", "?", "!"]);

// ---------- Word → segment grouping ----------
//
// Groups words into paragraph-sized segments of ~1 minute each.
// When the 1-minute window is reached, the cut is deferred to the next
// sentence boundary (word ending in ".", "?" or "!") so paragraphs always
// end cleanly. If no sentence boundary is found within a 30-second grace
// period, the paragraph is cut at the nearest word anyway.

function groupWordsIntoSegments(words: AssemblyAIWord[]): TranscriptSegment[] {
  if (words.length === 0) return [];

  const GRACE_MS = 30_000; // max extra time to wait for a sentence boundary

  const segments: TranscriptSegment[] = [];
  let currentWords: AssemblyAIWord[] = [];
  let currentStart = words[0].start;
  let hardCutAt: number | null = null; // timestamp after which we force a cut

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    currentWords.push(word);

    const duration = word.end - currentStart;
    const isLast = i === words.length - 1;
    const isSentenceEnd = SENTENCE_ENDERS.has(word.text.slice(-1));

    // Once we hit 1 minute, arm the hard-cut deadline (1 min + 30 s grace)
    if (hardCutAt === null && duration >= PARAGRAPH_DURATION_MS) {
      hardCutAt = currentStart + PARAGRAPH_DURATION_MS + GRACE_MS;
    }

    const shouldCut =
      isLast ||
      (hardCutAt !== null && isSentenceEnd) ||      // sentence boundary inside the window
      (hardCutAt !== null && word.end >= hardCutAt); // grace period exhausted — cut now

    if (shouldCut) {
      const text = currentWords.map((w) => w.text).join(" ").trim();
      if (text) {
        const avgConfidence =
          currentWords.reduce((sum, w) => sum + w.confidence, 0) / currentWords.length;
        segments.push({
          startMs: currentStart,
          endMs: word.end,
          text,
          confidence: avgConfidence,
          speakerLabel: currentWords[0].speaker ?? null,
        });
      }
      const nextWord = words[i + 1];
      if (nextWord) {
        currentWords = [];
        currentStart = nextWord.start;
        hardCutAt = null;
      }
    }
  }

  return segments;
}

// ---------- Transcript chunking ----------

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

// ---------- Embedding ----------

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

// ---------- AssemblyAI ----------

async function submitToAssemblyAI(audioUrl: string, apiKey: string): Promise<string> {
  const response = await fetch(`${ASSEMBLYAI_API_URL}/transcript`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: ["universal-2"],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AssemblyAI submit error: ${response.status} - ${errorText}`);
  }

  const payload = await response.json();
  if (!payload.id) throw new Error("AssemblyAI did not return a transcript ID");
  return payload.id as string;
}

async function pollAssemblyAI(
  transcriptId: string,
  apiKey: string
): Promise<{ words: AssemblyAIWord[]; audioDurationMs: number | null; language: string | null }> {
  while (true) {
    const response = await fetch(`${ASSEMBLYAI_API_URL}/transcript/${transcriptId}`, {
      headers: { Authorization: apiKey },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AssemblyAI poll error: ${response.status} - ${errorText}`);
    }

    const payload = await response.json();

    if (payload.status === "completed") {
      return {
        words: Array.isArray(payload.words) ? payload.words : [],
        audioDurationMs:
          typeof payload.audio_duration === "number"
            ? Math.round(payload.audio_duration * 1000)
            : null,
        language:
          typeof payload.language_code === "string" ? payload.language_code : null,
      };
    }

    if (payload.status === "error") {
      throw new Error(`AssemblyAI transcription failed: ${payload.error || "Unknown error"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, ASSEMBLYAI_POLL_INTERVAL_MS));
  }
}

// ---------- Finalize (chunk + embed + store) ----------

async function finalizeTranscription(opts: {
  materialId: string;
  allSegments: TranscriptSegment[];
  durationMs: number | null;
  language: string | null;
  adminClient: any;
  geminiApiKey: string;
}) {
  const { materialId, allSegments, durationMs, language, adminClient, geminiApiKey } = opts;

  const transcriptChunks = buildTranscriptChunks(allSegments);
  if (transcriptChunks.length === 0) {
    throw new Error("The transcript did not contain enough text to index");
  }

  await adminClient
    .from("materials")
    .update({ processing_status: "processing", processing_stage: "chunking", processing_progress: 72 })
    .eq("id", materialId);

  await adminClient.from("material_transcript_segments").delete().eq("material_id", materialId);
  await adminClient.from("chunks").delete().eq("material_id", materialId);

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
    const { error } = await adminClient
      .from("material_transcript_segments")
      .insert(transcriptRows.slice(i, i + 250));
    if (error) throw new Error(`Failed to insert transcript segments: ${error.message}`);
  }

  await adminClient
    .from("materials")
    .update({ processing_status: "processing", processing_stage: "embedding", processing_progress: 80 })
    .eq("id", materialId);

  const chunkRows = [];
  for (let i = 0; i < transcriptChunks.length; i++) {
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
    const { error } = await adminClient.from("chunks").insert(chunkRows.slice(i, i + 100));
    if (error) throw new Error(`Failed to insert transcript chunks: ${error.message}`);
  }

  await adminClient
    .from("materials")
    .update({
      processing_status: "completed",
      processing_error: null,
      processing_stage: "completed",
      processing_progress: 100,
      duration_ms: durationMs,
      transcription_provider: "assemblyai",
      transcription_language: language,
      thumbnail_path: null,
      file_path: "",
    })
    .eq("id", materialId);

  return { segmentsInserted: transcriptRows.length, chunksInserted: chunkRows.length };
}

// ---------- Background worker ----------

async function processTranscription(opts: {
  materialId: string;
  audioUrl: string;
  assemblyApiKey: string;
  geminiApiKey: string;
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  const { materialId, audioUrl, assemblyApiKey, geminiApiKey, supabaseUrl, serviceRoleKey } = opts;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    await adminClient
      .from("materials")
      .update({ processing_status: "processing", processing_stage: "transcribing", processing_progress: 30 })
      .eq("id", materialId);

    const transcriptId = await submitToAssemblyAI(audioUrl, assemblyApiKey);
    console.log(`[transcribe] AssemblyAI job submitted: ${transcriptId}`);

    await adminClient
      .from("materials")
      .update({ external_transcript_id: transcriptId, processing_progress: 35 })
      .eq("id", materialId);

    const result = await pollAssemblyAI(transcriptId, assemblyApiKey);
    console.log(`[transcribe] AssemblyAI completed — ${result.words.length} words`);

    const segments = groupWordsIntoSegments(result.words);
    if (segments.length === 0) {
      throw new Error("AssemblyAI returned no usable words for transcription");
    }

    const finalResult = await finalizeTranscription({
      materialId,
      allSegments: segments,
      durationMs: result.audioDurationMs,
      language: result.language,
      adminClient,
      geminiApiKey,
    });

    console.log(`[transcribe] Done — ${finalResult.segmentsInserted} segments, ${finalResult.chunksInserted} chunks`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("[transcribe] Background processing failed:", error);
    await adminClient
      .from("materials")
      .update({ processing_status: "failed", processing_error: message, processing_stage: "failed", processing_progress: null })
      .eq("id", materialId);
  }
}

// ---------- Re-finalize: re-chunk + re-embed from existing transcript segments ----------

async function refinalizeTranscription(opts: {
  materialId: string;
  geminiApiKey: string;
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  const { materialId, geminiApiKey, supabaseUrl, serviceRoleKey } = opts;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    await adminClient
      .from("materials")
      .update({ processing_status: "processing", processing_error: null, processing_stage: "chunking", processing_progress: 70 })
      .eq("id", materialId);

    // Load all existing transcript segments
    const { data: segmentRows, error: segError } = await adminClient
      .from("material_transcript_segments")
      .select("start_ms, end_ms, text, confidence, speaker_label")
      .eq("material_id", materialId)
      .order("start_ms", { ascending: true });

    if (segError) throw new Error(`Failed to fetch segments: ${segError.message}`);
    if (!segmentRows || segmentRows.length === 0) {
      throw new Error("No transcript segments found — cannot re-finalize");
    }

    console.log(`[refinalize] Loaded ${segmentRows.length} transcript segments`);

    const allSegments: TranscriptSegment[] = segmentRows.map((row: any) => ({
      startMs: row.start_ms,
      endMs: row.end_ms,
      text: row.text,
      confidence: row.confidence,
      speakerLabel: row.speaker_label,
    }));

    // Fetch material for duration + language
    const { data: material } = await adminClient
      .from("materials")
      .select("duration_ms, transcription_language")
      .eq("id", materialId)
      .single();

    // Delete only chunks (keep transcript segments intact)
    await adminClient.from("chunks").delete().eq("material_id", materialId);

    const transcriptChunks = buildTranscriptChunks(allSegments);
    if (transcriptChunks.length === 0) {
      throw new Error("Transcript did not produce any chunks");
    }

    console.log(`[refinalize] Building ${transcriptChunks.length} chunks and embedding...`);

    await adminClient
      .from("materials")
      .update({ processing_stage: "embedding", processing_progress: 80 })
      .eq("id", materialId);

    const chunkRows = [];
    for (let i = 0; i < transcriptChunks.length; i++) {
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

      // Update progress incrementally
      if (i % 10 === 0) {
        await adminClient
          .from("materials")
          .update({ processing_progress: 80 + Math.round((i / transcriptChunks.length) * 18) })
          .eq("id", materialId);
      }
    }

    for (let i = 0; i < chunkRows.length; i += 100) {
      const { error } = await adminClient.from("chunks").insert(chunkRows.slice(i, i + 100));
      if (error) throw new Error(`Failed to insert chunks: ${error.message}`);
    }

    await adminClient
      .from("materials")
      .update({
        processing_status: "completed",
        processing_error: null,
        processing_stage: "completed",
        processing_progress: 100,
        duration_ms: material?.duration_ms ?? null,
        transcription_provider: "assemblyai",
        transcription_language: material?.transcription_language ?? null,
      })
      .eq("id", materialId);

    console.log(`[refinalize] Done — ${chunkRows.length} chunks embedded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[refinalize] Failed:", error);
    await adminClient
      .from("materials")
      .update({ processing_status: "failed", processing_error: message, processing_stage: "failed", processing_progress: null })
      .eq("id", materialId);
  }
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
    const assemblyApiKey = Deno.env.get("ASSEMBLY_API_KEY");

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!assemblyApiKey) {
      return new Response(
        JSON.stringify({ error: "ASSEMBLY_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

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

    const body = (await req.json()) as TranscribeRequest | RefinalizeRequest;
    materialIdForError = body.materialId;

    if (!body.materialId) {
      return new Response(
        JSON.stringify({ error: "materialId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Re-finalize mode: re-chunk + re-embed from existing transcript segments
    if ("refinalize" in body && body.refinalize) {
      const backgroundPromise = refinalizeTranscription({
        materialId: body.materialId,
        geminiApiKey,
        supabaseUrl,
        serviceRoleKey,
      });

      // @ts-ignore — Deno EdgeRuntime global
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(backgroundPromise);
      } else {
        await backgroundPromise;
      }

      return new Response(
        JSON.stringify({ success: true, queued: true, mode: "refinalize", materialId: body.materialId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!("audioUrl" in body) || !body.audioUrl) {
      return new Response(
        JSON.stringify({ error: "audioUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await adminClient
      .from("materials")
      .update({ processing_status: "processing", processing_error: null, processing_stage: "transcribing", processing_progress: 25 })
      .eq("id", body.materialId);

    const backgroundPromise = processTranscription({
      materialId: body.materialId,
      audioUrl: body.audioUrl,
      assemblyApiKey,
      geminiApiKey,
      supabaseUrl,
      serviceRoleKey,
    });

    // @ts-ignore — Deno EdgeRuntime global
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundPromise);
    } else {
      await backgroundPromise;
    }

    return new Response(
      JSON.stringify({ success: true, queued: true, materialId: body.materialId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("Transcribe video error:", error);

    if (materialIdForError) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, serviceRoleKey);
        await adminClient
          .from("materials")
          .update({ processing_status: "failed", processing_error: message, processing_stage: "failed", processing_progress: null })
          .eq("id", materialIdForError);
      } catch {}
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
