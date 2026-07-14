import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { HttpError, generateChatText, generateChatTextStream } from "../_shared/llm.ts";
import {
  buildCitationRewriteSourceContext,
  clipText,
  formatTimestamp,
  sanitizeAndRemapCitations,
  stripTrailingSourcesSection,
} from "../_shared/citations.ts";
import {
  dedupeRetrievedChunksByBestScore,
  rerankRetrievedChunks,
} from "../_shared/retrieval.ts";
import {
  buildConversationHistoryTurns,
  buildHistoryContext,
  buildOpenAIConversationMessages,
  type ConversationHistoryTurn,
} from "../_shared/history.ts";
import {
  buildSelectedDocumentEmptyAnswer,
  classifyQueryCategory,
  formatDocumentNameList,
  inferUnresolvedReason,
  isLikelyAmbiguousQuestion,
  normalizeSelectedDocumentIds,
  resolveChatModelTier,
  type ChatModelTier,
  type ResolvedSelectedMaterial,
} from "../_shared/query.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMBEDDING_MODEL = "gemini-embedding-001";
const CITATION_PIPELINE_VERSION = "2026-02-14-cite-token-rerank-v1";

interface ChatModelConfig {
  modelId: string;
  displayName: string;
}

const CHAT_MODEL_CONFIGS: Record<ChatModelTier, ChatModelConfig> = {
  fast: { modelId: "gpt-4o-mini", displayName: "Fast (GPT-4o mini)" },
  smart: { modelId: "gpt-4o", displayName: "Smart (GPT-4o)" },
  pro: { modelId: "gpt-4.1", displayName: "Pro (GPT-4.1)" },
};

const HIGH_RECALL_MATCH_THRESHOLD = 0.50;
const HIGH_RECALL_MATCH_COUNT = 18;
const FINAL_MATCH_COUNT = 10;
const RELEVANCE_FLOOR = 0.55;
const CONVERSATION_HISTORY_FETCH_LIMIT = 24;

interface ChatRequest {
  message: string;
  conversationId?: string;
  courseId?: string;
  selectedDocumentIds?: string[];
  model?: string;
  skipRag?: boolean;
}

interface RetrievedChunk {
  id: string;
  chunk_text: string;
  material_id: string | null;
  student_document_id: string | null;
  page_number: number | null;
  start_ms: number | null;
  end_ms: number | null;
  relevance_score: number;
  material_name?: string;
  material_type?: string;
  document_name?: string;
  document_type?: string;
}

interface QueryEventInsert {
  user_id: string;
  conversation_id: string;
  course_id: string;
  academic_term_id: string | null;
  user_message_id: string;
  assistant_message_id: string;
  query_text: string;
  query_category: string;
  retrieved_chunk_count: number;
  citation_count: number;
  citation_hit: boolean;
  unresolved: boolean;
  unresolved_reason: string | null;
  latency_ms: number | null;
}

interface ChatTextGenerationOptions {
  modelConfig: ChatModelConfig;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  historyTurns?: ConversationHistoryTurn[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

interface ChatStreamGenerationOptions extends ChatTextGenerationOptions {
  onTextDelta?: (delta: string) => Promise<void> | void;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function formatSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function generateGeminiText(options: ChatTextGenerationOptions): Promise<string> {
  return generateChatText({
    apiKey: options.apiKey,
    model: options.modelConfig.modelId,
    messages: buildOpenAIConversationMessages(options.systemPrompt, options.userPrompt, options.historyTurns),
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    signal: options.signal,
  });
}

async function generateGeminiTextStream(options: ChatStreamGenerationOptions): Promise<string> {
  return generateChatTextStream({
    apiKey: options.apiKey,
    model: options.modelConfig.modelId,
    messages: buildOpenAIConversationMessages(options.systemPrompt, options.userPrompt, options.historyTurns),
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    signal: options.signal,
    onTextDelta: options.onTextDelta,
  });
}

async function rewriteQueryForRetrieval(options: {
  modelConfig: ChatModelConfig;
  apiKey: string;
  studentQuestion: string;
  historyContext: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (!isLikelyAmbiguousQuestion(options.studentQuestion, options.historyContext)) {
    return options.studentQuestion;
  }

  const rewriteSystemPrompt = `You rewrite vague follow-up student questions into standalone retrieval queries.
Rules:
1. Keep the original intent unchanged.
2. Resolve ambiguous references using the conversation context.
3. Return one concise standalone query.
4. Do not answer the question.
5. Return plain text only.`;

  const rewriteUserPrompt = `Conversation context:
${options.historyContext}

Student question:
${options.studentQuestion}

Standalone retrieval query:`;

  try {
    const rewritten = await generateGeminiText({
      modelConfig: options.modelConfig,
      apiKey: options.apiKey,
      systemPrompt: rewriteSystemPrompt,
      userPrompt: rewriteUserPrompt,
      temperature: 0,
      maxOutputTokens: 160,
      signal: options.signal,
    });

    const cleaned = rewritten
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) {
      return options.studentQuestion;
    }

    // Guardrail: avoid runaway rewrite output.
    if (cleaned.length > 280) {
      return options.studentQuestion;
    }

    return cleaned;
  } catch (rewriteError) {
    console.warn("Query rewrite failed, falling back to original question", rewriteError);
    return options.studentQuestion;
  }
}

async function embedQuery(geminiApiKey: string, query: string, signal?: AbortSignal): Promise<number[]> {
  const embeddingResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`, {
    method: "POST",
    signal,
    headers: {
      "x-goog-api-key": geminiApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text: query }],
      },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 1536,
    }),
  });

  if (!embeddingResponse.ok) {
    const errorText = await embeddingResponse.text();
    console.error("Gemini Embedding API error:", embeddingResponse.status, errorText);

    if (embeddingResponse.status === 429) {
      throw new HttpError(429, "Rate limit exceeded. Please try again later.");
    }

    throw new Error(`Embedding API error: ${embeddingResponse.status} - ${errorText}`);
  }

  const embeddingData = await embeddingResponse.json();
  const queryEmbedding = embeddingData.embedding?.values;

  if (!Array.isArray(queryEmbedding)) {
    throw new Error("Embedding response did not include values");
  }

  return queryEmbedding as number[];
}

async function retrieveChunkCandidates(options: {
  supabaseClient: ReturnType<typeof createClient>;
  userId: string;
  courseId: string;
  embedding: number[];
  threshold: number;
  count: number;
  selectedMaterialIds?: string[];
}): Promise<RetrievedChunk[]> {
  const { data: chunks, error: searchError } = await options.supabaseClient.rpc(
    "match_chunks",
    {
      query_embedding: options.embedding,
      match_threshold: options.threshold,
      match_count: options.count,
      user_id: options.userId,
      course_id_filter: options.courseId,
      selected_material_ids: options.selectedMaterialIds && options.selectedMaterialIds.length > 0
        ? options.selectedMaterialIds
        : null,
    }
  );

  if (searchError) {
    console.error("Vector search error:", searchError);
    return [];
  }

  return (chunks || []) as RetrievedChunk[];
}

async function getActiveAcademicTermId(
  supabaseClient: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data, error } = await supabaseClient
    .from("academic_terms")
    .select("id")
    .eq("is_active", true)
    .order("sort_key", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Failed to load active academic term:", error);
    return null;
  }

  return data?.id || null;
}

async function insertQueryEvent(
  supabaseClient: ReturnType<typeof createClient>,
  payload: QueryEventInsert,
): Promise<void> {
  const { error } = await supabaseClient
    .from("query_events")
    .insert(payload);

  if (error) {
    console.error("Failed to insert query analytics event:", error);
  }
}

async function formatAnswerWithReliableCitations(options: {
  modelConfig: ChatModelConfig;
  apiKey: string;
  question: string;
  rawAnswer: string;
  chunks: RetrievedChunk[];
  signal?: AbortSignal;
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
2. Use ONLY citation markers in the format <<cite:n>>.
3. Only use citation numbers that exist in the provided source list.
4. Place citations immediately after the sentence or claim they support.
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
      modelConfig: options.modelConfig,
      apiKey: options.apiKey,
      systemPrompt: citationRewriteSystemPrompt,
      userPrompt: citationRewriteUserPrompt,
      temperature: 0.1,
      maxOutputTokens: 1800,
      signal: options.signal,
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

  const { data: isAdmin, error: adminError } = await supabaseClient.rpc("is_admin", {
    check_user_id: userId,
  });

  if (adminError) {
    throw new Error(`Failed to verify admin role: ${adminError.message}`);
  }

  return Boolean(isAdmin);
}

async function resolveSelectedMaterials(
  supabaseClient: ReturnType<typeof createClient>,
  courseId: string,
  selectedDocumentIds: string[],
): Promise<ResolvedSelectedMaterial[]> {
  if (selectedDocumentIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseClient
    .from("materials")
    .select("id, file_name")
    .eq("course_id", courseId)
    .eq("processing_status", "completed")
    .in("id", selectedDocumentIds);

  if (error) {
    throw new Error(`Failed to validate selected documents: ${error.message}`);
  }

  const resolvedMaterials = (data || []).map((material) => ({
    id: material.id,
    fileName: material.file_name,
  }));

  if (resolvedMaterials.length !== selectedDocumentIds.length) {
    throw new HttpError(
      400,
      "One or more selected documents are unavailable for this course. Refresh the page and try again.",
    );
  }

  const orderById = new Map(resolvedMaterials.map((material) => [material.id, material]));
  return selectedDocumentIds
    .map((documentId) => orderById.get(documentId))
    .filter((material): material is ResolvedSelectedMaterial => Boolean(material));
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

    if (requestedCourseId && requestedCourseId !== existingConversation.course_id) {
      throw new HttpError(
        400,
        "Selected course does not match this conversation. Start a new chat to switch courses.",
      );
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

  const requestAbortController = new AbortController();
  const abortRequestWork = (reason?: unknown) => {
    if (!requestAbortController.signal.aborted) {
      requestAbortController.abort(reason);
    }
  };

  req.signal.addEventListener(
    "abort",
    () => {
      console.log("RAG chat request aborted by client");
      abortRequestWork("client disconnected");
    },
    { once: true },
  );

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
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!geminiApiKey) {
      console.error("GEMINI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Embedding service is not configured. Please add GEMINI_API_KEY secret." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!openAiApiKey) {
      console.error("OPENAI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Chat service is not configured. Please add OPENAI_API_KEY secret." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolved after parsing the request body below; declared here for closure access in the stream.
    let chatModelConfig: ChatModelConfig = CHAT_MODEL_CONFIGS.fast;
    const chatApiKey: string = openAiApiKey;

    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdminClient = createClient(supabaseUrl, supabaseKey);

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

    const { data: userProfile } = await supabaseClient
      .from("profiles")
      .select("custom_instructions")
      .eq("user_id", user.id)
      .maybeSingle();

    const customInstructionsBlock = userProfile?.custom_instructions
      ? `\n\nUSER PREFERENCES AND INSTRUCTIONS:\n${userProfile.custom_instructions}`
      : "";

    const {
      message,
      conversationId,
      courseId,
      selectedDocumentIds: rawSelectedDocumentIds,
      model: rawModel,
      skipRag: rawSkipRag,
    } = await req.json() as ChatRequest;
    const trimmedMessage = message?.trim();
    const selectedDocumentIds = normalizeSelectedDocumentIds(rawSelectedDocumentIds);
    const skipRag = rawSkipRag === true;

    const modelTier = resolveChatModelTier(rawModel);
    chatModelConfig = CHAT_MODEL_CONFIGS[modelTier];

    if (!trimmedMessage) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestStartedAt = Date.now();
    throwIfAborted(requestAbortController.signal);

    const resolved = await resolveConversation(
      supabaseClient,
      user.id,
      trimmedMessage,
      conversationId,
      courseId,
    );

    throwIfAborted(requestAbortController.signal);

    const activeConversationId = resolved.conversationId;
    const activeCourseId = resolved.courseId;

    // ── Fetch conversation history (always needed) ──────────────────────
    const [activeAcademicTermId, { data: recentMessages, error: historyError }] = await Promise.all([
      getActiveAcademicTermId(supabaseClient),
      supabaseClient
        .from("messages")
        .select("role, content")
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: false })
        .limit(CONVERSATION_HISTORY_FETCH_LIMIT),
    ]);

    if (historyError) {
      console.error("Failed to load conversation history:", historyError);
    }

    const priorMessages = [...(recentMessages || [])].reverse();
    const historyTurns = buildConversationHistoryTurns(priorMessages);

    // ── Variables shared by both RAG and no-RAG paths ─────────────────
    let retrievedChunks: RetrievedChunk[] = [];
    let selectedMaterials: ResolvedSelectedMaterial[] = [];
    let hasSelectedDocumentFilter = false;
    let systemPrompt: string;

    if (skipRag) {
      // ── No-RAG path: answer from model knowledge only ─────────────────
      console.log(`Processing no-RAG chat for user ${user.id}: "${trimmedMessage.substring(0, 50)}..." in conversation ${activeConversationId}`);

      systemPrompt = `You are EduChat, an AI learning assistant for university students.

The user has chosen to chat without grounding the answer in any uploaded course documents. Answer using your general knowledge.

FORMATTING: Every section title or topic heading MUST use ## markdown headings. Never write a heading as plain unformatted text. Use **bold** for key terms and emphasis within paragraphs. Use bullet points for lists. Use markdown tables when presenting comparative or tabular data. Add clear vertical spacing: leave one blank line after every heading and one blank line between paragraphs/sections.

Do NOT include any citation markers (<<cite:N>>) since there are no retrieved sources.

Use prior conversation turns to resolve follow-up references like "this", "that", "it", or "the previous example".${customInstructionsBlock}`;
    } else {
      // ── RAG path: retrieve relevant chunks then answer ─────────────────
      selectedMaterials = await resolveSelectedMaterials(
        supabaseClient,
        activeCourseId,
        selectedDocumentIds,
      );
      const selectedMaterialIds = selectedMaterials.map((material) => material.id);

      throwIfAborted(requestAbortController.signal);

      const originalEmbedding = await embedQuery(geminiApiKey, trimmedMessage, requestAbortController.signal);

      console.log(`Processing RAG chat for user ${user.id}: "${trimmedMessage.substring(0, 50)}..." in conversation ${activeConversationId}`);

      const historyContext = buildHistoryContext(historyTurns);

      throwIfAborted(requestAbortController.signal);

      const rewrittenQuery = await rewriteQueryForRetrieval({
        modelConfig: chatModelConfig,
        apiKey: chatApiKey,
        studentQuestion: trimmedMessage,
        historyContext,
        signal: requestAbortController.signal,
      });

      // Only embed the rewritten query if it differs from the original
      const embeddings = [originalEmbedding];
      const retrievalQueries = [trimmedMessage];
      if (rewrittenQuery.trim() && rewrittenQuery.trim() !== trimmedMessage.trim()) {
        retrievalQueries.push(rewrittenQuery.trim());
        embeddings.push(await embedQuery(geminiApiKey, rewrittenQuery, requestAbortController.signal));
      }

      throwIfAborted(requestAbortController.signal);

      // Detect broad summary/overview queries — needs wider retrieval with lower thresholds
      const isSummaryQuery = /\b(summarize|summary|overview|key points?|main points?|recap|outline|what.*cover|what.*about|tell me about|give me an? (overview|summary|recap))\b/i.test(trimmedMessage);

      const matchThreshold = isSummaryQuery ? 0.40 : HIGH_RECALL_MATCH_THRESHOLD;
      const matchCount     = isSummaryQuery ? 30   : HIGH_RECALL_MATCH_COUNT;
      const relevanceFloor = isSummaryQuery ? 0.40 : RELEVANCE_FLOOR;
      const finalCount     = isSummaryQuery ? 10   : FINAL_MATCH_COUNT;

      const retrievedChunkGroups = await Promise.all(
        embeddings.map((embedding) =>
          retrieveChunkCandidates({
            supabaseClient,
            userId: user.id,
            courseId: activeCourseId,
            embedding,
            threshold: matchThreshold,
            count: matchCount,
            selectedMaterialIds,
          })
        )
      );

      throwIfAborted(requestAbortController.signal);

      const highRecallChunks = dedupeRetrievedChunksByBestScore(retrievedChunkGroups.flat());
      let rerankedChunks = rerankRetrievedChunks(
        highRecallChunks,
        rewrittenQuery || trimmedMessage,
        finalCount
      );

      // For summary queries on video materials: spread chunks across the full timeline
      // by dropping chunks whose time windows heavily overlap an already-selected chunk
      if (isSummaryQuery) {
        const spread: typeof rerankedChunks = [];
        const OVERLAP_THRESHOLD_MS = 60_000; // 1 minute
        for (const chunk of rerankedChunks) {
          if (typeof chunk.start_ms !== "number") {
            spread.push(chunk);
            continue;
          }
          const chunkStart = chunk.start_ms!;
          const overlaps = spread.some(
            (c) =>
              typeof c.start_ms === "number" &&
              c.start_ms !== null &&
              Math.abs(c.start_ms - chunkStart) < OVERLAP_THRESHOLD_MS
          );
          if (!overlaps) spread.push(chunk);
        }
        rerankedChunks = spread;
      }

      retrievedChunks = rerankedChunks.filter(
        (c) => c.relevance_score >= relevanceFloor
      );

      console.log(
        `Retrieved ${highRecallChunks.length} high-recall chunks from ${retrievalQueries.length} query variant(s); reranked to ${rerankedChunks.length}; ${retrievedChunks.length} above relevance floor. Selected document filter count: ${selectedMaterialIds.length}.`
      );

      hasSelectedDocumentFilter = selectedMaterials.length > 0;
      let ragContext = "";
      if (retrievedChunks.length > 0) {
        ragContext = hasSelectedDocumentFilter
          ? "\n\n## Relevant Selected Documents:\n\n"
          : "\n\n## Relevant Course Materials:\n\n";
        retrievedChunks.forEach((chunk, index) => {
          const sourceName = chunk.material_name || chunk.document_name || "Unknown document";
          const sourceType = chunk.material_type || chunk.document_type || "document";
          const locator =
            typeof chunk.start_ms === "number"
              ? ` (${formatTimestamp(chunk.start_ms)}${
                  typeof chunk.end_ms === "number" ? `-${formatTimestamp(chunk.end_ms)}` : ""
                })`
              : chunk.page_number
                ? ` (Page ${chunk.page_number})`
                : "";

          ragContext += `### Source [${index + 1}]: ${sourceName}${locator} [${sourceType}]\n`;
          ragContext += `${clipText(chunk.chunk_text, 1300)}\n\n`;
        });
      }

      const retrievalScopeInstruction = hasSelectedDocumentFilter
        ? `DOCUMENT SCOPE: The user selected a document filter. You may ground your answer ONLY in these documents: ${formatDocumentNameList(selectedMaterials)}. Do not use any outside course materials, prior assumptions, or unstated course context beyond those selected documents. If the selected documents do not contain enough evidence, say the answer is not available in the selected documents.`
        : "DOCUMENT SCOPE: No document filter is active. You may use any retrieved material from the selected course.";
      const retrievalContextHeading = hasSelectedDocumentFilter
        ? "The following are relevant excerpts from the selected documents:"
        : "The following are relevant excerpts from the course materials:";
      const noResultsInstruction = hasSelectedDocumentFilter
        ? "No relevant excerpts were found in the selected documents for this query. Tell the student the answer is not available in the selected documents."
        : "No relevant course materials were found for this query.";

      const summaryInstruction = isSummaryQuery
        ? "\nSUMMARY MODE: The student is asking for a broad summary or overview. Use ALL provided sources to give comprehensive coverage across the full material. Organise your response with clear ## sections for each major topic. Do not focus only on the most similar source — synthesise across all citations.\n"
        : "";

      systemPrompt = `You are EduChat, an AI learning assistant for university students.

Answer questions using the provided course materials when relevant. Format responses in clean markdown. Start with a direct answer, then elaborate with structure if needed.
${summaryInstruction}

FORMATTING: Every section title or topic heading MUST use ## markdown headings. Never write a heading as plain unformatted text. Use **bold** for key terms and emphasis within paragraphs. Use bullet points for lists. Use markdown tables when presenting comparative or tabular data. Add clear vertical spacing: leave one blank line after every heading and one blank line between paragraphs/sections.

CITATIONS: Cite sources inline using <<cite:1>>, <<cite:2>> etc. immediately after the claim they support. Do NOT add a "Sources" or "References" section at the end. Only use citation numbers that correspond to provided sources.

Examples:
- "Virtual memory allows for larger address spaces <<cite:1>>."
- "The CPU schedules processes based on priority <<cite:2>>. This ensures efficiency <<cite:3>>."

RELEVANCE: Before citing a source, verify it genuinely answers the question — not just that it shares keywords. If the question is outside the scope of the course materials, say so and suggest the student search online. Do not force-fit unrelated material.

Use prior conversation turns to resolve follow-up references like "this", "that", "it", or "the previous example".${customInstructionsBlock}

${retrievalScopeInstruction}

${ragContext ? retrievalContextHeading : noResultsInstruction}
${ragContext}`;
    }

    let streamCancelled = false;
    const cancelStream = (reason?: unknown) => {
      if (streamCancelled) {
        return;
      }

      streamCancelled = true;
      console.log("RAG chat stream cancelled", reason);
      abortRequestWork(reason);
    };

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (event: string, payload: unknown) => {
          if (streamCancelled) {
            return;
          }
          controller.enqueue(encoder.encode(formatSseEvent(event, payload)));
        };

        const ensureStreamActive = () => {
          throwIfAborted(requestAbortController.signal);
          if (streamCancelled) {
            throw new DOMException("The operation was aborted.", "AbortError");
          }
        };

        (async () => {
          try {
            ensureStreamActive();

            if (hasSelectedDocumentFilter && retrievedChunks.length === 0) {
              const answer = buildSelectedDocumentEmptyAnswer(selectedMaterials);

              sendEvent("final", {
                answer,
                citations: [],
                conversationId: activeConversationId,
                meta: {
                  chatModel: chatModelConfig.modelId,
                  embeddingModel: EMBEDDING_MODEL,
                  citationPipelineVersion: CITATION_PIPELINE_VERSION,
                },
              });

              const userMsgCreatedAt = new Date().toISOString();
              const assistantMsgCreatedAt = new Date(Date.now() + 1).toISOString();

              const userMessageResult = await supabaseClient
                .from("messages")
                .insert({
                  conversation_id: activeConversationId,
                  role: "user",
                  content: trimmedMessage,
                  created_at: userMsgCreatedAt,
                })
                .select("id")
                .single();

              const assistantMessageResult = await supabaseClient
                .from("messages")
                .insert({
                  conversation_id: activeConversationId,
                  role: "assistant",
                  content: answer,
                  created_at: assistantMsgCreatedAt,
                })
                .select("id")
                .single();

              if (!userMessageResult.error && userMessageResult.data && !assistantMessageResult.error && assistantMessageResult.data) {
                const queryCategory = classifyQueryCategory(trimmedMessage);
                const unresolvedReason = inferUnresolvedReason({
                  retrievedChunkCount: 0,
                  citationCount: 0,
                  answer,
                });

                await Promise.all([
                  supabaseClient
                    .from("conversations")
                    .update({ updated_at: new Date().toISOString() })
                    .eq("id", activeConversationId),
                  insertQueryEvent(supabaseAdminClient, {
                    user_id: user.id,
                    conversation_id: activeConversationId,
                    course_id: activeCourseId,
                    academic_term_id: activeAcademicTermId,
                    user_message_id: userMessageResult.data.id,
                    assistant_message_id: assistantMessageResult.data.id,
                    query_text: trimmedMessage,
                    query_category: queryCategory,
                    retrieved_chunk_count: 0,
                    citation_count: 0,
                    citation_hit: false,
                    unresolved: unresolvedReason !== null,
                    unresolved_reason: unresolvedReason,
                    latency_ms: Date.now() - requestStartedAt,
                  }),
                ]);
              } else {
                if (userMessageResult.error) {
                  console.error(`Failed to save user message: ${userMessageResult.error.message}`);
                }
                if (assistantMessageResult.error) {
                  console.error(`Failed to save assistant message: ${assistantMessageResult.error.message}`);
                }
              }

              return;
            }

            const rawAnswer = await generateGeminiTextStream({
              modelConfig: chatModelConfig,
              apiKey: chatApiKey,
              systemPrompt,
              userPrompt: trimmedMessage,
              historyTurns,
              temperature: 0.4,
              maxOutputTokens: 2000,
              signal: requestAbortController.signal,
              onTextDelta: (delta) => {
                ensureStreamActive();
                sendEvent("token", { text: delta });
              },
            });

            ensureStreamActive();

            const { answer, citedChunks } = await formatAnswerWithReliableCitations({
              modelConfig: chatModelConfig,
              apiKey: chatApiKey,
              question: trimmedMessage,
              rawAnswer,
              chunks: retrievedChunks,
              signal: requestAbortController.signal,
            });

            ensureStreamActive();

            const citations = citedChunks.map((chunk, index) => ({
              id: `citation-${index + 1}`,
              chunkId: chunk.id,
              excerpt: chunk.chunk_text.substring(0, 300) + (chunk.chunk_text.length > 300 ? "..." : ""),
              documentName: chunk.material_name || chunk.document_name || "Unknown document",
              documentType: chunk.material_type || chunk.document_type || "document",
              pageNumber: chunk.page_number,
              startMs: chunk.start_ms,
              endMs: chunk.end_ms,
              relevanceScore: chunk.relevance_score,
            }));

            // Send the final event to the client BEFORE persisting to DB.
            // This ensures the user always sees the complete answer even if
            // a subsequent database write fails.
            sendEvent("final", {
              answer,
              citations,
              conversationId: activeConversationId,
              meta: {
                chatModel: chatModelConfig.modelId,
                embeddingModel: EMBEDDING_MODEL,
                citationPipelineVersion: CITATION_PIPELINE_VERSION,
              },
            });

            console.log(`Successfully generated response with ${citations.length} citations`);

            // --- Persist to database (best-effort after client has received the answer) ---

            // Insert user message first with explicit timestamps 1ms apart so that
            // ordering by created_at always returns user before assistant.
            const userMsgCreatedAt = new Date().toISOString();
            const assistantMsgCreatedAt = new Date(Date.now() + 1).toISOString();

            const userMessageResult = await supabaseClient
              .from("messages")
              .insert({
                conversation_id: activeConversationId,
                role: "user",
                content: trimmedMessage,
                created_at: userMsgCreatedAt,
              })
              .select("id")
              .single();

            const assistantMessageResult = await supabaseClient
              .from("messages")
              .insert({
                conversation_id: activeConversationId,
                role: "assistant",
                content: answer,
                created_at: assistantMsgCreatedAt,
              })
              .select("id")
              .single();

            if (userMessageResult.error || !userMessageResult.data) {
              console.error(`Failed to save user message: ${userMessageResult.error?.message || "Unknown error"}`);
              return;
            }

            if (assistantMessageResult.error || !assistantMessageResult.data) {
              console.error(`Failed to save assistant message: ${assistantMessageResult.error?.message || "Unknown error"}`);
              return;
            }

            const userMessage = userMessageResult.data;
            const assistantMessage = assistantMessageResult.data;

            // Citations, conversation update, and analytics can all run in parallel
            const queryCategory = classifyQueryCategory(trimmedMessage);
            const unresolvedReason = inferUnresolvedReason({
              retrievedChunkCount: retrievedChunks.length,
              citationCount: citedChunks.length,
              answer,
            });
            const unresolved = unresolvedReason !== null;

            await Promise.all([
              // Insert citations
              (async () => {
                if (citedChunks.length > 0) {
                  const { error: citationsError } = await supabaseClient
                    .from("citations")
                    .insert(citedChunks.map((chunk) => ({
                      message_id: assistantMessage.id,
                      chunk_id: chunk.id,
                      relevance_score: chunk.relevance_score,
                      excerpt: chunk.chunk_text.substring(0, 300) + (chunk.chunk_text.length > 300 ? "..." : ""),
                    })));
                  if (citationsError) console.error(`Failed to save citations: ${citationsError.message}`);
                }
              })(),
              // Update conversation timestamp
              supabaseClient
                .from("conversations")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", activeConversationId),
              // Insert analytics event
              insertQueryEvent(supabaseAdminClient, {
                user_id: user.id,
                conversation_id: activeConversationId,
                course_id: activeCourseId,
                academic_term_id: activeAcademicTermId,
                user_message_id: userMessage.id,
                assistant_message_id: assistantMessage.id,
                query_text: trimmedMessage,
                query_category: queryCategory,
                retrieved_chunk_count: retrievedChunks.length,
                citation_count: citedChunks.length,
                citation_hit: citedChunks.length > 0,
                unresolved,
                unresolved_reason: unresolvedReason,
                latency_ms: Date.now() - requestStartedAt,
              }),
            ]);
          } catch (streamError) {
            if (isAbortError(streamError)) {
              console.log("RAG chat stream aborted");
              return;
            }

            console.error("RAG chat stream error:", streamError);

            const status = streamError instanceof HttpError ? streamError.status : 500;
            const message = streamError instanceof Error ? streamError.message : "An unexpected error occurred";

            sendEvent("error", { error: message, status });
          } finally {
            if (!streamCancelled) {
              controller.close();
            }
          }
        })();
      },
      cancel(reason) {
        cancelStream(reason);
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
    if (isAbortError(error)) {
      console.log("RAG chat request aborted before completion");
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    console.error("RAG chat error:", error);

    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "An unexpected error occurred";

    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
