import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_CONVERSATIONS_PER_USER = 3;
const EMBEDDING_MODEL = "gemini-embedding-001";
const CHAT_MODEL = "gemini-3-flash-preview";
const CITATION_PIPELINE_VERSION = "2026-02-10-reliable-citations-v1";

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

interface CitationSanitizationResult {
  text: string;
  citedChunkNumbers: number[];
}

interface GeminiTextGenerationOptions {
  geminiApiKey: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

interface GeminiStreamGenerationOptions extends GeminiTextGenerationOptions {
  onTextDelta?: (delta: string) => Promise<void> | void;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NON_CITATION_PREVIOUS_WORDS = new Set([
  "step",
  "section",
  "chapter",
  "week",
  "part",
  "item",
  "example",
  "option",
]);

function stripTrailingSourcesSection(text: string): string {
  const withoutBlockSources = text.replace(/\n{1,}(?:#{1,6}\s*)?sources\s*:?\s*[\s\S]*$/i, "");
  const withoutInlineSources = withoutBlockSources.replace(/\s+sources\s*:\s*(?:\[\d+\]|\d+\s+\S)[\s\S]*$/i, "");
  return withoutInlineSources.trim();
}

function clipText(value: string, maxLength = 1200): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trim()}...`;
}

function sourceLabel(chunk: RetrievedChunk): string {
  const name = chunk.material_name || chunk.document_name || "Unknown document";
  const pageInfo = chunk.page_number ? ` (Page ${chunk.page_number})` : "";
  return `${name}${pageInfo}`;
}

function normalizeLegacyCitationMarkers(content: string, maxSourceNumber: number): string {
  if (maxSourceNumber < 1) {
    return content;
  }

  // Convert any existing square brackets to parentheses first to normalize
  const normalized = content.replace(/\[([1-9]\d*)\]/g, "($1)");

  return normalized.replace(/(\S)\s+([1-9]\d*)([.,;!?])?(?=\s|$)/g, (match, previousChar, rawNumber, punctuation, offset, fullText) => {
    const citationNumber = Number(rawNumber);
    if (!Number.isFinite(citationNumber) || citationNumber < 1 || citationNumber > maxSourceNumber) {
      return match;
    }

    const textBeforeMatch = fullText.slice(0, Number(offset) + 1);
    const previousWord = textBeforeMatch.match(/([A-Za-z]+)\s*$/)?.[1]?.toLowerCase();
    if (previousWord && NON_CITATION_PREVIOUS_WORDS.has(previousWord)) {
      return match;
    }

    const punc = punctuation || "";
    return `${previousChar} (${citationNumber})${punc}`;
  });
}

function sanitizeAndRemapCitations(rawAnswer: string, maxSourceNumber: number): CitationSanitizationResult {
  const cleanedAnswer = stripTrailingSourcesSection(rawAnswer.trim());
  const normalizedAnswer = normalizeLegacyCitationMarkers(cleanedAnswer, maxSourceNumber);

  const orderedOriginalCitationNumbers: number[] = [];
  const seenOriginalCitationNumbers = new Set<number>();

  for (const match of normalizedAnswer.matchAll(/\((\d+)\)/g)) {
    const citationNumber = Number(match[1]);
    if (!Number.isFinite(citationNumber) || citationNumber < 1 || citationNumber > maxSourceNumber) {
      continue;
    }
    if (!seenOriginalCitationNumbers.has(citationNumber)) {
      seenOriginalCitationNumbers.add(citationNumber);
      orderedOriginalCitationNumbers.push(citationNumber);
    }
  }

  const remappedCitationNumbers = new Map<number, number>();
  orderedOriginalCitationNumbers.forEach((originalCitationNumber, index) => {
    remappedCitationNumbers.set(originalCitationNumber, index + 1);
  });

  const remappedAnswer = normalizedAnswer.replace(/\((\d+)\)/g, (_, rawNumber) => {
    const citationNumber = Number(rawNumber);
    const mappedCitationNumber = remappedCitationNumbers.get(citationNumber);
    return mappedCitationNumber ? `(${mappedCitationNumber})` : "";
  });

  const cleanedRemappedAnswer = remappedAnswer
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();

  return {
    text: cleanedRemappedAnswer,
    citedChunkNumbers: orderedOriginalCitationNumbers,
  };
}

function buildCitationRewriteSourceContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const sourceType = chunk.material_type || chunk.document_type || "document";
      return [
        `(${index + 1}) ${sourceLabel(chunk)} (${sourceType})`,
        clipText(chunk.chunk_text, 900),
      ].join("\n");
    })
    .join("\n\n");
}

function extractGeminiText(aiData: unknown): string {
  if (!aiData || typeof aiData !== "object") {
    return "";
  }

  const candidates = (aiData as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }

  const firstCandidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } };
  const parts = firstCandidate.content?.parts || [];

  return parts
    .map((part) => part.text || "")
    .join("");
}

function formatSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function generateGeminiText(options: GeminiTextGenerationOptions): Promise<string> {
  const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": options.geminiApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: options.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: options.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: options.temperature ?? 0.4,
        maxOutputTokens: options.maxOutputTokens ?? 2000,
      },
    }),
  });

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("Gemini Chat API error:", aiResponse.status, errorText);

    if (aiResponse.status === 429) {
      throw new HttpError(429, "Rate limit exceeded. Please try again later.");
    }

    throw new Error(`Chat API error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json() as unknown;
  return extractGeminiText(aiData).trim() || "I couldn't generate a response.";
}

async function generateGeminiTextStream(options: GeminiStreamGenerationOptions): Promise<string> {
  const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: {
      "x-goog-api-key": options.geminiApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: options.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: options.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: options.temperature ?? 0.4,
        maxOutputTokens: options.maxOutputTokens ?? 2000,
      },
    }),
  });

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("Gemini Chat Stream API error:", aiResponse.status, errorText);

    if (aiResponse.status === 429) {
      throw new HttpError(429, "Rate limit exceeded. Please try again later.");
    }

    throw new Error(`Chat stream API error: ${aiResponse.status}`);
  }

  if (!aiResponse.body) {
    throw new Error("Chat stream response did not include a body");
  }

  const reader = aiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let latestSnapshot = "";

  const processRawSseEvent = async (rawEvent: string) => {
    if (!rawEvent.trim()) {
      return;
    }

    const dataLines = rawEvent
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return;
    }

    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      return;
    }

    const chunkText = extractGeminiText(parsedPayload);
    if (!chunkText) {
      return;
    }

    let delta = chunkText;
    if (chunkText.startsWith(latestSnapshot)) {
      delta = chunkText.slice(latestSnapshot.length);
      latestSnapshot = chunkText;
    } else if (latestSnapshot.endsWith(chunkText)) {
      delta = "";
    } else {
      latestSnapshot += chunkText;
    }

    if (!delta) {
      return;
    }

    fullText += delta;
    if (options.onTextDelta) {
      await options.onTextDelta(delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      await processRawSseEvent(rawEvent);
      boundaryIndex = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processRawSseEvent(buffer);
  }

  return fullText.trim() || "I couldn't generate a response.";
}

async function formatAnswerWithReliableCitations(options: {
  geminiApiKey: string;
  question: string;
  rawAnswer: string;
  chunks: RetrievedChunk[];
}): Promise<{ answer: string; citedChunks: RetrievedChunk[] }> {
  const cleanedAnswer = stripTrailingSourcesSection(options.rawAnswer.trim());
  if (options.chunks.length === 0) {
    return {
      answer: cleanedAnswer,
      citedChunks: [],
    };
  }

  let sanitized = sanitizeAndRemapCitations(cleanedAnswer, options.chunks.length);

  if (sanitized.citedChunkNumbers.length === 0) {
    const citationRewriteSystemPrompt = `You are a citation editor for a retrieval-augmented generation system.
Your job is to add reliable inline citations to an existing draft answer.

Rules:
1. Keep the answer content the same; only add or adjust citation markers.
2. Use ONLY citation markers in the format (n) (parentheses).
3. Only use citation numbers that exist in the provided source list.
4. Place citations immediately after the sentence or claim they support, BEFORE the period.
5. Do NOT add a sources section.
6. Preserve the original markdown structure and wording as much as possible.
7. Do not add, remove, or rename headings.
8. Return only the revised answer in markdown.`;

    const citationRewriteUserPrompt = `Question:
${options.question}

Draft answer:
${cleanedAnswer}

Allowed sources:
${buildCitationRewriteSourceContext(options.chunks)}`;

    const rewrittenAnswer = await generateGeminiText({
      geminiApiKey: options.geminiApiKey,
      systemPrompt: citationRewriteSystemPrompt,
      userPrompt: citationRewriteUserPrompt,
      temperature: 0.1,
      maxOutputTokens: 1800,
    });

    sanitized = sanitizeAndRemapCitations(rewrittenAnswer, options.chunks.length);
  }

  const citedChunks = sanitized.citedChunkNumbers
    .map((citationNumber) => options.chunks[citationNumber - 1])
    .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));

  if (citedChunks.length === 0) {
    return {
      answer: sanitized.text || cleanedAnswer,
      citedChunks: [],
    };
  }

  return {
    answer: sanitized.text,
    citedChunks,
  };
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

  if (enrolled) {
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

    const embeddingResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
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

        ragContext += `### Source [${index + 1}]: ${sourceName}${pageInfo} [${sourceType}]\n`;
        ragContext += `${clipText(chunk.chunk_text, 1300)}\n\n`;
      });
    }

    const historySection = historyContext
      ? `\n\nConversation so far:\n${historyContext}`
      : "";

    const systemPrompt = `You are EduChat, an AI learning assistant for university students. Your role is to answer questions about course materials accurately and helpfully.

IMPORTANT GUIDELINES:
1. Base your answers on the provided course materials when available.
2. ALWAYS cite your sources using numbered references in parentheses, e.g., (1), (2).
3. Place citation markers (n) immediately after the sentence or claim they support, BEFORE the period.
4. If the information is not in the provided materials, say so clearly.
5. Use markdown formatting for better readability.
6. Be concise but thorough.
7. Do NOT output a "Sources" section. Only use inline citations like (1).
8. Use only citation numbers that correspond to provided sources.
9. Keep formatting consistent across answers:
   - If the response is short (1-2 brief paragraphs), do not use headings.
   - If headings are needed, use only level-2 markdown headings (##) in Title Case.
   - Use at most 3 sections and keep heading style consistent throughout.
   - Do not use bold text as fake headings.
10. Prefer this structure for multi-part answers:
    - A brief direct answer first.
    - Then sections such as "## Key Points" and "## Explanation" when helpful.
11. Use bullet points for lists/comparisons; avoid mixing list styles in one section.

Citation format examples (follow exactly):
- "Virtual memory allows for larger address spaces (1)."
- "The CPU schedules processes based on priority (2). This ensures efficiency (3)."

${ragContext ? "The following are relevant excerpts from the course materials. Use these to answer the student's question:" : "No specific course materials were found for this query. Provide a helpful general response but note that this isn't from the course materials."}
${ragContext}${historySection}`;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (event: string, payload: unknown) => {
          controller.enqueue(encoder.encode(formatSseEvent(event, payload)));
        };

        (async () => {
          try {
            const rawAnswer = await generateGeminiTextStream({
              geminiApiKey,
              systemPrompt,
              userPrompt: trimmedMessage,
              temperature: 0.4,
              maxOutputTokens: 2000,
              onTextDelta: (delta) => {
                sendEvent("token", { text: delta });
              },
            });

            const { answer, citedChunks } = await formatAnswerWithReliableCitations({
              geminiApiKey,
              question: trimmedMessage,
              rawAnswer,
              chunks: retrievedChunks,
            });

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

            if (citedChunks.length > 0) {
              const citationRows = citedChunks.map((chunk) => ({
                message_id: assistantMessage.id,
                chunk_id: chunk.id,
                relevance_score: chunk.relevance_score,
                excerpt: chunk.chunk_text.substring(0, 300) + (chunk.chunk_text.length > 300 ? "..." : ""),
              }));

              const { error: citationsError } = await supabaseClient
                .from("citations")
                .insert(citationRows);

              if (citationsError) {
                throw new Error(`Failed to save citations: ${citationsError.message}`);
              }
            }

            await supabaseClient
              .from("conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", activeConversationId);

            const citations = citedChunks.map((chunk, index) => ({
              id: `citation-${index + 1}`,
              chunkId: chunk.id,
              excerpt: chunk.chunk_text.substring(0, 300) + (chunk.chunk_text.length > 300 ? "..." : ""),
              documentName: chunk.material_name || chunk.document_name || "Unknown document",
              documentType: chunk.material_type || chunk.document_type || "document",
              pageNumber: chunk.page_number,
              relevanceScore: chunk.relevance_score,
            }));

            console.log(`Successfully generated response with ${citations.length} citations`);

            sendEvent("final", {
              answer,
              citations,
              conversationId: activeConversationId,
              meta: {
                chatModel: CHAT_MODEL,
                embeddingModel: EMBEDDING_MODEL,
                citationPipelineVersion: CITATION_PIPELINE_VERSION,
              },
            });
          } catch (streamError) {
            console.error("RAG chat stream error:", streamError);

            const status = streamError instanceof HttpError ? streamError.status : 500;
            const message = streamError instanceof Error ? streamError.message : "An unexpected error occurred";

            sendEvent("error", { error: message, status });
          } finally {
            controller.close();
          }
        })();
      },
      cancel(reason) {
        console.log("RAG chat stream cancelled", reason);
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });

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
