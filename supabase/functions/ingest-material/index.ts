import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { chunkText } from "../_shared/chunking.ts";

interface IngestRequest {
  materialId: string;
  text: string;
}

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_OVERLAP = 200;
const MAX_TEXT_LENGTH = 500_000;
const MAX_TEXT_CHUNKS = 250;
const EMBEDDING_CONCURRENCY = 4;
const EMBEDDING_PROGRESS_START = 70;
const EMBEDDING_PROGRESS_END = 95;

const embedText = async (chunk: string, geminiApiKey: string, chunkIndex: number) => {
  let lastStatus: number | null = null;
  let lastErrorText = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const embeddingResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": geminiApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: chunk }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 1536,
        }),
      }
    );

    if (embeddingResponse.ok) {
      const embeddingData = await embeddingResponse.json();
      const values = embeddingData.embedding?.values;
      if (!Array.isArray(values)) {
        throw new Error(`Embedding response did not include values at chunk ${chunkIndex}`);
      }
      return values as number[];
    }

    lastStatus = embeddingResponse.status;
    lastErrorText = await embeddingResponse.text();
    const isTransient = embeddingResponse.status === 429 || embeddingResponse.status >= 500;

    if (!isTransient || attempt === 2) {
      break;
    }

    const backoffMs = 1500 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  throw new Error(`Embedding failed at chunk ${chunkIndex}: ${lastStatus ?? "unknown"} - ${lastErrorText || "No response body"}`);
};

const embedChunksConcurrently = async (options: {
  chunks: { text: string; start: number; end: number }[];
  geminiApiKey: string;
  materialId: string;
  supabaseClient: ReturnType<typeof createClient>;
}) => {
  const rows: {
    material_id: string;
    chunk_index: number;
    chunk_text: string;
    embedding: number[];
    start_position: number;
    end_position: number;
  }[] = new Array(options.chunks.length);

  let nextIndex = 0;
  let completedCount = 0;

  const syncProgress = async () => {
    const completionRatio =
      options.chunks.length === 0 ? 1 : completedCount / options.chunks.length;
    const nextProgress = Math.min(
      EMBEDDING_PROGRESS_END,
      Math.round(
        EMBEDDING_PROGRESS_START +
          (EMBEDDING_PROGRESS_END - EMBEDDING_PROGRESS_START) * completionRatio,
      ),
    );

    await options.supabaseClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_stage: "embedding",
        processing_progress: nextProgress,
      })
      .eq("id", options.materialId);
  };

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= options.chunks.length) {
        return;
      }

      const chunk = options.chunks[currentIndex];
      const embedding = await embedText(chunk.text, options.geminiApiKey, currentIndex);
      rows[currentIndex] = {
        material_id: options.materialId,
        chunk_index: currentIndex,
        chunk_text: chunk.text,
        embedding,
        start_position: chunk.start,
        end_position: chunk.end,
      };

      completedCount += 1;
      if (
        completedCount === options.chunks.length ||
        completedCount % EMBEDDING_CONCURRENCY === 0
      ) {
        await syncProgress();
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(EMBEDDING_CONCURRENCY, options.chunks.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return rows;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let materialIdForError: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "Embedding service is not configured. Please add GEMINI_API_KEY secret." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Unable to verify user role" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (profile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { materialId, text } = await req.json() as IngestRequest;
    materialIdForError = materialId;

    if (!materialId || !text) {
      return new Response(
        JSON.stringify({ error: "materialId and text are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters` }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: materialError } = await supabaseClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_error: null,
        processing_stage: "chunking",
        processing_progress: 45,
      })
      .eq("id", materialId);

    if (materialError) {
      throw new Error(`Failed to update material status: ${materialError.message}`);
    }

    const chunks = chunkText(text, DEFAULT_CHUNK_SIZE, DEFAULT_OVERLAP);

    if (chunks.length === 0) {
      throw new Error("No text content to process");
    }

    if (chunks.length > MAX_TEXT_CHUNKS) {
      throw new Error(
        `Text expands to ${chunks.length} chunks, which exceeds the processing limit of ${MAX_TEXT_CHUNKS}. Split the file into smaller parts.`,
      );
    }

    await supabaseClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_stage: "embedding",
        processing_progress: EMBEDDING_PROGRESS_START,
      })
      .eq("id", materialId);

    const rows = await embedChunksConcurrently({
      chunks,
      geminiApiKey,
      materialId,
      supabaseClient,
    });

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insertError } = await supabaseClient.from("chunks").insert(batch);
      if (insertError) {
        throw new Error(`Failed to insert chunks: ${insertError.message}`);
      }
    }

    await supabaseClient
      .from("materials")
      .update({
        processing_status: "completed",
        processing_error: null,
        processing_stage: "completed",
        processing_progress: 100,
      })
      .eq("id", materialId);

    return new Response(
      JSON.stringify({ inserted: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("Ingest material error:", error);

    if (materialIdForError) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        await supabaseClient
          .from("materials")
          .update({
            processing_status: "failed",
            processing_error: message,
            processing_stage: "failed",
            processing_progress: null,
          })
          .eq("id", materialIdForError);
      } catch (updateError) {
        console.error("Failed to update material error status:", updateError);
      }
    }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
