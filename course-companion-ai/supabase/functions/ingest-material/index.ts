import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface IngestRequest {
  materialId: string;
  text: string;
  chunkSize?: number;
  overlap?: number;
}

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_OVERLAP = 200;
const MAX_TEXT_LENGTH = 500_000;

const chunkText = (text: string, chunkSize: number, overlap: number) => {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\t/g, " ");
  const cleaned = normalized.replace(/[ ]{2,}/g, " ").trim();
  if (!cleaned) return [];

  const safeChunkSize = Math.max(200, chunkSize);
  const safeOverlap = Math.min(Math.max(0, overlap), Math.floor(safeChunkSize * 0.5));
  const step = Math.max(1, safeChunkSize - safeOverlap);

  const chunks: { text: string; start: number; end: number }[] = [];
  for (let start = 0; start < cleaned.length; start += step) {
    const end = Math.min(start + safeChunkSize, cleaned.length);
    const slice = cleaned.slice(start, end).trim();
    if (slice) {
      chunks.push({ text: slice, start, end });
    }
  }
  return chunks;
};

const embedText = async (chunk: string, geminiApiKey: string) => {
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

  if (!embeddingResponse.ok) {
    const errorText = await embeddingResponse.text();
    throw new Error(`Embedding API error: ${embeddingResponse.status} - ${errorText}`);
  }

  const embeddingData = await embeddingResponse.json();
  const values = embeddingData.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error("Embedding response did not include values");
  }
  return values as number[];
};

serve(async (req) => {
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

    if (!["admin", "lecturer"].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { materialId, text, chunkSize, overlap } = await req.json() as IngestRequest;
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
      .update({ processing_status: "processing", processing_error: null })
      .eq("id", materialId);

    if (materialError) {
      throw new Error(`Failed to update material status: ${materialError.message}`);
    }

    const chunks = chunkText(
      text,
      chunkSize ?? DEFAULT_CHUNK_SIZE,
      overlap ?? DEFAULT_OVERLAP
    );

    if (chunks.length === 0) {
      throw new Error("No text content to process");
    }

    const rows: {
      material_id: string;
      chunk_index: number;
      chunk_text: string;
      embedding: number[];
      start_position: number;
      end_position: number;
    }[] = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const embedding = await embedText(chunk.text, geminiApiKey);
      rows.push({
        material_id: materialId,
        chunk_index: i,
        chunk_text: chunk.text,
        embedding,
        start_position: chunk.start,
        end_position: chunk.end,
      });
    }

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
      .update({ processing_status: "completed", processing_error: null })
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
          .update({ processing_status: "failed", processing_error: message })
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
