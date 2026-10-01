import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { chunkText } from "../_shared/chunking.ts";
import { EMBEDDING_COLUMN, type EmbeddingService } from "../_shared/embeddings.ts";
import { createOpenAIEmbeddingService } from "../_shared/llm.ts";

interface IngestRequest {
  materialId: string;
  text: string;
}

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_OVERLAP = 200;
const MAX_TEXT_LENGTH = 500_000;
const MAX_TEXT_CHUNKS = 250;
const EMBEDDING_PROGRESS_START = 70;
const EMBEDDING_PROGRESS_END = 95;

const embedChunks = async (options: {
  chunks: { text: string; start: number; end: number }[];
  embeddingService: EmbeddingService;
  materialId: string;
  supabaseClient: ReturnType<typeof createClient>;
}) => {
  const syncProgress = async (embeddedCount: number, totalCount: number) => {
    const completionRatio = totalCount === 0 ? 1 : embeddedCount / totalCount;
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

  const vectors = await options.embeddingService.embedDocuments(
    options.chunks.map((chunk) => chunk.text),
    { onProgress: syncProgress },
  );

  return options.chunks.map((chunk, index) => ({
    material_id: options.materialId,
    chunk_index: index,
    chunk_text: chunk.text,
    [EMBEDDING_COLUMN]: vectors[index],
    start_position: chunk.start,
    end_position: chunk.end,
  }));
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
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openAiApiKey) {
      return new Response(
        JSON.stringify({ error: "Embedding service is not configured. Please add OPENAI_API_KEY secret." }),
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

    const rows = await embedChunks({
      chunks,
      embeddingService: createOpenAIEmbeddingService(openAiApiKey),
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
