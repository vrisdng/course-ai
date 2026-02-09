import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_CONVERSATIONS_PER_USER = 3;

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

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function hasCourseAccess(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string,
  checkCourseId: string,
): Promise<boolean> {
  const { data: enrolled, error: enrolledError } = await supabaseClient.rpc("is_enrolled", {
    check_user_id: userId,
    check_course_id: checkCourseId,
  });

  if (enrolledError) {
    throw new Error(`Failed to verify enrollment: ${enrolledError.message}`);
  }

  if (Boolean(enrolled)) {
    return true;
  }

  const { data: staff, error: staffError } = await supabaseClient.rpc("is_course_lecturer", {
    check_user_id: userId,
    check_course_id: checkCourseId,
  });

  if (staffError) {
    throw new Error(`Failed to verify staff role: ${staffError.message}`);
  }

  return Boolean(staff);
}

async function findDefaultCourseId(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data: enrollmentRow, error: enrollmentError } = await supabaseClient
    .from("enrollments")
    .select("course_id, enrolled_at")
    .eq("user_id", userId)
    .order("enrolled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (enrollmentError) {
    throw new Error(`Failed to load enrollments: ${enrollmentError.message}`);
  }

  if (enrollmentRow?.course_id) {
    return enrollmentRow.course_id;
  }

  const { data: profileRow, error: profileError } = await supabaseClient
    .from("profiles")
    .select("id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Failed to load profile: ${profileError.message}`);
  }

  if (!profileRow) {
    return null;
  }

  if (profileRow.role === "admin") {
    const { data: anyCourse, error: anyCourseError } = await supabaseClient
      .from("courses")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (anyCourseError) {
      throw new Error(`Failed to load fallback course: ${anyCourseError.message}`);
    }

    return anyCourse?.id || null;
  }

  if (profileRow.role === "lecturer") {
    const { data: lecturerCourse, error: lecturerCourseError } = await supabaseClient
      .from("courses")
      .select("id")
      .eq("created_by", profileRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lecturerCourseError) {
      throw new Error(`Failed to load lecturer course: ${lecturerCourseError.message}`);
    }

    return lecturerCourse?.id || null;
  }

  return null;
}

async function resolveConversation(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string,
  message: string,
  conversationId?: string,
  requestedCourseId?: string,
): Promise<{ conversationId: string; courseId: string }> {
  if (conversationId) {
    const { data: existingConversation, error: conversationError } = await supabaseClient
      .from("conversations")
      .select("id, course_id, user_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (conversationError) {
      throw new Error(`Failed to load conversation: ${conversationError.message}`);
    }

    if (!existingConversation || existingConversation.user_id !== userId) {
      throw new HttpError(403, "Conversation not found or access denied");
    }

    return {
      conversationId: existingConversation.id,
      courseId: existingConversation.course_id,
    };
  }

  let resolvedCourseId = requestedCourseId || null;

  if (resolvedCourseId) {
    const allowed = await hasCourseAccess(supabaseClient, userId, resolvedCourseId);
    if (!allowed) {
      throw new HttpError(403, "You do not have access to the selected course");
    }
  } else {
    resolvedCourseId = await findDefaultCourseId(supabaseClient, userId);
  }

  if (!resolvedCourseId) {
    throw new HttpError(400, "No accessible course found for this account");
  }

  const { count, error: countError } = await supabaseClient
    .from("conversations")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId);

  if (countError) {
    throw new Error(`Failed to check conversation limit: ${countError.message}`);
  }

  if ((count || 0) >= MAX_CONVERSATIONS_PER_USER) {
    throw new HttpError(400, `Conversation limit reached (max ${MAX_CONVERSATIONS_PER_USER})`);
  }

  const title = message.length > 80 ? `${message.slice(0, 77)}...` : message;

  const { data: newConversation, error: createConversationError } = await supabaseClient
    .from("conversations")
    .insert({
      user_id: userId,
      course_id: resolvedCourseId,
      title,
    })
    .select("id, course_id")
    .single();

  if (createConversationError || !newConversation) {
    throw new Error(createConversationError?.message || "Failed to create conversation");
  }

  return {
    conversationId: newConversation.id,
    courseId: newConversation.course_id,
  };
}

serve(async (req) => {
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

    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

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
    const trimmedMessage = message?.trim();

    if (!trimmedMessage) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resolved = await resolveConversation(
      supabaseClient,
      user.id,
      trimmedMessage,
      conversationId,
      courseId,
    );

    const activeConversationId = resolved.conversationId;

    console.log(`Processing RAG chat for user ${user.id}: "${trimmedMessage.substring(0, 50)}..." in conversation ${activeConversationId}`);

    const { data: recentMessages, error: historyError } = await supabaseClient
      .from("messages")
      .select("role, content")
      .eq("conversation_id", activeConversationId)
      .order("created_at", { ascending: false })
      .limit(8);

    if (historyError) {
      console.error("Failed to load conversation history:", historyError);
    }

    const priorMessages = [...(recentMessages || [])].reverse();
    const historyContext = priorMessages.length > 0
      ? priorMessages
          .map((item) => `${item.role === "assistant" ? "Assistant" : "Student"}: ${item.content}`)
          .join("\n")
      : "";

    const embeddingResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: {
          parts: [{ text: trimmedMessage }],
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
    }

    const retrievedChunks: RetrievedChunk[] = chunks || [];
    console.log(`Retrieved ${retrievedChunks.length} relevant chunks`);

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

    const historySection = historyContext
      ? `\n\nConversation so far:\n${historyContext}`
      : "";

    const systemPrompt = `You are EduChat, an AI learning assistant for university students. Your role is to answer questions about course materials accurately and helpfully.

IMPORTANT GUIDELINES:
1. Base your answers on the provided course materials when available
2. Always cite your sources using numbered references like [1], [2], etc.
3. If the information is not in the provided materials, say so clearly
4. Be educational and explain concepts clearly
5. Use markdown formatting for better readability
6. Be concise but thorough

${ragContext ? "The following are relevant excerpts from the course materials. Use these to answer the student's question:" : "No specific course materials were found for this query. Provide a helpful general response but note that this isn't from the course materials."}
${ragContext}${historySection}`;

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
            parts: [{ text: trimmedMessage }],
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

    const { error: userMessageError } = await supabaseClient
      .from("messages")
      .insert({
        conversation_id: activeConversationId,
        role: "user",
        content: trimmedMessage,
      });

    if (userMessageError) {
      throw new Error(`Failed to save user message: ${userMessageError.message}`);
    }

    const { data: assistantMessage, error: assistantMessageError } = await supabaseClient
      .from("messages")
      .insert({
        conversation_id: activeConversationId,
        role: "assistant",
        content: answer,
      })
      .select("id")
      .single();

    if (assistantMessageError || !assistantMessage) {
      throw new Error(`Failed to save assistant message: ${assistantMessageError?.message || "Unknown error"}`);
    }

    if (retrievedChunks.length > 0) {
      const citationRows = retrievedChunks.map((chunk) => ({
        message_id: assistantMessage.id,
        chunk_id: chunk.id,
        relevance_score: chunk.relevance_score,
        excerpt: chunk.chunk_text.substring(0, 300) + (chunk.chunk_text.length > 300 ? "..." : ""),
      }));

      const { error: citationsError } = await supabaseClient
        .from("citations")
        .insert(citationRows);

      if (citationsError) {
        console.error("Failed to save citations:", citationsError);
      }
    }

    await supabaseClient
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", activeConversationId);

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
        conversationId: activeConversationId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("RAG chat error:", error);

    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "An unexpected error occurred";

    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
