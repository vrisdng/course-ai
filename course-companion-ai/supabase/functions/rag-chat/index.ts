import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ChatRequest {
  message: string;
  conversationId?: string;
  courseId?: string;
}

interface RetrievedChunk {
  id: string;
  chunk_text: string;
  material_id: string | null;
  student_document_id: string | null;
  page_number: number | null;
  relevance_score: number;
  material_name?: string;
  material_type?: string;
  document_name?: string;
  document_type?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
      console.error("GEMINI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Embedding service is not configured. Please add GEMINI_API_KEY secret." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with user's auth token for RLS
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { message, conversationId, courseId } = await req.json() as ChatRequest;

    if (!message || message.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing RAG chat for user ${user.id}: "${message.substring(0, 50)}..."`);

    // Step 1: Generate embedding for the query
    const embeddingResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: {
          parts: [{ text: message }],
        },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 1536,
      }),
    });

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text();
      console.error("Gemini Embedding API error:", embeddingResponse.status, errorText);
      
      if (embeddingResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`Embedding API error: ${embeddingResponse.status} - ${errorText}`);
    }

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.embedding?.values;

    if (!Array.isArray(queryEmbedding)) {
      throw new Error("Embedding response did not include values");
    }

    // Step 2: Perform vector similarity search
    const { data: chunks, error: searchError } = await supabaseClient.rpc(
      "match_chunks",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 5,
        user_id: user.id,
      }
    );

    if (searchError) {
      console.error("Vector search error:", searchError);
      // Continue without RAG if no chunks found
    }

    const retrievedChunks: RetrievedChunk[] = chunks || [];
    console.log(`Retrieved ${retrievedChunks.length} relevant chunks`);

    // Step 3: Build context from retrieved chunks
    let ragContext = "";
    if (retrievedChunks.length > 0) {
      ragContext = "\n\n## Relevant Course Materials:\n\n";
      retrievedChunks.forEach((chunk, index) => {
        const sourceName = chunk.material_name || chunk.document_name || "Unknown document";
        const sourceType = chunk.material_type || chunk.document_type || "document";
        const pageInfo = chunk.page_number ? ` (Page ${chunk.page_number})` : "";
        
        ragContext += `### Source ${index + 1}: ${sourceName}${pageInfo} [${sourceType}]\n`;
        ragContext += `${chunk.chunk_text}\n\n`;
      });
    }

    // Step 4: Generate response using Gemini
    const systemPrompt = `You are EduChat, an AI learning assistant for university students. Your role is to answer questions about course materials accurately and helpfully.

IMPORTANT GUIDELINES:
1. Base your answers on the provided course materials when available
2. Always cite your sources using numbered references like [1], [2], etc.
3. If the information is not in the provided materials, say so clearly
4. Be educational and explain concepts clearly
5. Use markdown formatting for better readability
6. Be concise but thorough

${ragContext ? "The following are relevant excerpts from the course materials. Use these to answer the student's question:" : "No specific course materials were found for this query. Provide a helpful general response but note that this isn't from the course materials."}
${ragContext}`;

    const aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent", {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: message }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
        },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Gemini Chat API error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`Chat API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const answer = aiData.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("")
      .trim() || "I couldn't generate a response.";

    // Step 5: Format citations for the frontend
    const citations = retrievedChunks.map((chunk, index) => ({
      id: `citation-${index + 1}`,
      chunkId: chunk.id,
      excerpt: chunk.chunk_text.substring(0, 300) + (chunk.chunk_text.length > 300 ? "..." : ""),
      documentName: chunk.material_name || chunk.document_name || "Unknown document",
      documentType: chunk.material_type || chunk.document_type || "document",
      pageNumber: chunk.page_number,
      relevanceScore: chunk.relevance_score,
    }));

    console.log(`Successfully generated response with ${citations.length} citations`);

    return new Response(
      JSON.stringify({
        answer,
        citations,
        conversationId: conversationId || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("RAG chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
