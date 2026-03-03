import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMBEDDING_MODEL = "gemini-embedding-001";
const CHAT_MODEL = "gemini-3-flash-preview";
const CITATION_PIPELINE_VERSION = "2026-02-14-cite-token-rerank-v1";
const HIGH_RECALL_MATCH_THRESHOLD = 0.35;
const HIGH_RECALL_MATCH_COUNT = 18;
const FINAL_MATCH_COUNT = 6;
const CITATION_TOKEN_PATTERN = "<<cite:(\\d+)>>";
const CONVERSATION_HISTORY_FETCH_LIMIT = 24;
const CONVERSATION_HISTORY_PROMPT_LIMIT = 14;
const CONVERSATION_HISTORY_CHAR_BUDGET = 9000;
const CONVERSATION_HISTORY_MESSAGE_CLIP = 850;
const MEMORY_CITATION_TOKEN_PATTERN = /<<\s*cite\s*:\s*[1-9]\d*\s*>>/gi;

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

interface CitationSanitizationResult {
  text: string;
  citedChunkNumbers: number[];
}

interface ConversationHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

interface GeminiContentTurn {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiTextGenerationOptions {
  geminiApiKey: string;
  systemPrompt: string;
  userPrompt: string;
  historyTurns?: ConversationHistoryTurn[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
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

const AMBIGUOUS_QUERY_MARKERS = [
  /\b(this|that|these|those)\b/i,
  /\b(it|they|them)\b/i,
  /\babove|below|earlier|previous|last one\b/i,
  /\bwhat about\b/i,
  /\bcan you explain this\b/i,
  /\bmore on that\b/i,
];

const LEXICAL_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "s",
  "such",
  "t",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "will",
  "with",
  "you",
  "your",
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

function sanitizeMessageForMemory(content: string): string {
  const withoutCitationTokens = content.replace(MEMORY_CITATION_TOKEN_PATTERN, "");
  const withoutTrailingSources = stripTrailingSourcesSection(withoutCitationTokens);

  return withoutTrailingSources
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildConversationHistoryTurns(
  rawMessages: Array<{ role: string; content: string }>
): ConversationHistoryTurn[] {
  const normalized = rawMessages
    .map((message): ConversationHistoryTurn | null => {
      const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
      if (!role || typeof message.content !== "string") {
        return null;
      }

      const cleaned = role === "assistant"
        ? sanitizeMessageForMemory(message.content)
        : message.content
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

      if (!cleaned) {
        return null;
      }

      return {
        role,
        content: clipText(cleaned, CONVERSATION_HISTORY_MESSAGE_CLIP),
      };
    })
    .filter((message): message is ConversationHistoryTurn => Boolean(message));

  const tailLimited = normalized.slice(-CONVERSATION_HISTORY_PROMPT_LIMIT);

  let totalChars = 0;
  const budgeted: ConversationHistoryTurn[] = [];
  for (let index = tailLimited.length - 1; index >= 0; index -= 1) {
    const message = tailLimited[index];
    const projectedSize = message.content.length + 24;

    if (budgeted.length > 0 && totalChars + projectedSize > CONVERSATION_HISTORY_CHAR_BUDGET) {
      break;
    }

    budgeted.push(message);
    totalChars += projectedSize;
  }

  return budgeted.reverse();
}

function buildHistoryContext(historyTurns: ConversationHistoryTurn[]): string {
  return historyTurns
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "Student"}: ${turn.content}`)
    .join("\n");
}

function buildGeminiConversationContents(
  userPrompt: string,
  historyTurns: ConversationHistoryTurn[] = []
): GeminiContentTurn[] {
  const contents = historyTurns.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));

  contents.push({
    role: "user",
    parts: [{ text: userPrompt }],
  });

  return contents;
}

function sourceLabel(chunk: RetrievedChunk): string {
  const name = chunk.material_name || chunk.document_name || "Unknown document";
  if (typeof chunk.start_ms === "number") {
    const start = formatTimestamp(chunk.start_ms);
    const end =
      typeof chunk.end_ms === "number" ? `-${formatTimestamp(chunk.end_ms)}` : "";
    return `${name} (${start}${end})`;
  }

  const pageInfo = chunk.page_number ? ` (Page ${chunk.page_number})` : "";
  return `${name}${pageInfo}`;
}

function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isLikelyAmbiguousQuestion(message: string, historyContext: string): boolean {
  if (!historyContext.trim()) {
    return false;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const shortQuestion = wordCount <= 9 || trimmed.length <= 60;
  const hasAmbiguousMarker = AMBIGUOUS_QUERY_MARKERS.some((pattern) => pattern.test(trimmed));

  return shortQuestion || hasAmbiguousMarker;
}

function tokenizeForLexicalScore(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !LEXICAL_STOP_WORDS.has(token));
}

function lexicalOverlapScore(query: string, chunkText: string): number {
  const queryTokens = Array.from(new Set(tokenizeForLexicalScore(query)));
  if (queryTokens.length === 0) {
    return 0;
  }

  const chunkTokens = new Set(tokenizeForLexicalScore(chunkText));
  let overlap = 0;

  for (const token of queryTokens) {
    if (chunkTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / queryTokens.length;
}

function dedupeRetrievedChunksByBestScore(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const byChunkId = new Map<string, RetrievedChunk>();

  for (const chunk of chunks) {
    const existing = byChunkId.get(chunk.id);
    if (!existing || chunk.relevance_score > existing.relevance_score) {
      byChunkId.set(chunk.id, chunk);
    }
  }

  return Array.from(byChunkId.values());
}

function rerankRetrievedChunks(chunks: RetrievedChunk[], query: string, topK: number): RetrievedChunk[] {
  const scored = chunks.map((chunk) => {
    const semantic = Math.max(0, Math.min(1, chunk.relevance_score));
    const lexical = lexicalOverlapScore(query, chunk.chunk_text);
    const combinedScore = semantic * 0.72 + lexical * 0.28;
    return { chunk, combinedScore };
  });

  scored.sort((a, b) => b.combinedScore - a.combinedScore);
  return scored.slice(0, topK).map((entry) => entry.chunk);
}

function classifyQueryCategory(message: string): string {
  const text = message.trim().toLowerCase();

  if (!text) {
    return "other";
  }

  if (/\b(compare|difference|versus|vs\.?|pros and cons)\b/.test(text)) {
    return "comparison";
  }

  if (/\b(how do i|how to|steps|process|procedure|implement|apply)\b/.test(text)) {
    return "how_to_process";
  }

  if (/\b(calculate|compute|equation|formula|derive|proof|solve)\b/.test(text)) {
    return "calculation";
  }

  if (/\b(error|bug|issue|debug|fix|failing|doesn't work|not working)\b/.test(text)) {
    return "troubleshooting";
  }

  if (/\b(what is|define|definition|concept|meaning|explain)\b/.test(text)) {
    return "definition_concept";
  }

  if (/\b(when|where|who|which|list|name)\b/.test(text)) {
    return "factual_lookup";
  }

  return "other";
}

function inferUnresolvedReason(options: {
  retrievedChunkCount: number;
  citationCount: number;
  answer: string;
}): string | null {
  if (options.retrievedChunkCount === 0) {
    return "no_retrieval";
  }

  if (options.citationCount === 0) {
    return "no_citations";
  }

  const loweredAnswer = options.answer.toLowerCase();
  const materialGapPattern = /(not (?:in|from) (?:the )?(?:provided )?(?:course )?materials|not available in (?:the )?(?:provided )?(?:course )?materials|cannot find this in (?:the )?materials)/;
  if (materialGapPattern.test(loweredAnswer)) {
    return "insufficient_materials";
  }

  return null;
}

function normalizeCitationTokens(content: string, maxSourceNumber: number): string {
  if (maxSourceNumber < 1) {
    return content;
  }

  let normalized = content.replace(/<<\s*cite\s*:\s*([1-9]\d*)\s*>>/gi, (_, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (citationNumber < 1 || citationNumber > maxSourceNumber) {
      return "";
    }
    return `<<cite:${citationNumber}>>`;
  });

  // Backward compatibility: convert explicit [n] and (n) markers only.
  normalized = normalized.replace(/\[([1-9]\d*)\]/g, (match, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (citationNumber < 1 || citationNumber > maxSourceNumber) {
      return match;
    }
    return `<<cite:${citationNumber}>>`;
  });

  normalized = normalized.replace(/\(([1-9]\d*)\)/g, (match, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (citationNumber < 1 || citationNumber > maxSourceNumber) {
      return match;
    }
    return `<<cite:${citationNumber}>>`;
  });

  return normalized;
}

function sanitizeAndRemapCitations(rawAnswer: string, maxSourceNumber: number): CitationSanitizationResult {
  const cleanedAnswer = stripTrailingSourcesSection(rawAnswer.trim());
  const normalizedAnswer = normalizeCitationTokens(cleanedAnswer, maxSourceNumber);

  const orderedOriginalCitationNumbers: number[] = [];
  const seenOriginalCitationNumbers = new Set<number>();

  for (const match of normalizedAnswer.matchAll(new RegExp(CITATION_TOKEN_PATTERN, "g"))) {
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

  const remappedAnswer = normalizedAnswer.replace(new RegExp(CITATION_TOKEN_PATTERN, "g"), (_, rawNumber) => {
    const citationNumber = Number(rawNumber);
    const mappedCitationNumber = remappedCitationNumbers.get(citationNumber);
    return mappedCitationNumber ? `<<cite:${mappedCitationNumber}>>` : "";
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
        `Source ${index + 1}: ${sourceLabel(chunk)} (${sourceType})`,
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
    signal: options.signal,
    headers: {
      "x-goog-api-key": options.geminiApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: options.systemPrompt }],
      },
      contents: buildGeminiConversationContents(options.userPrompt, options.historyTurns),
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
    signal: options.signal,
    headers: {
      "x-goog-api-key": options.geminiApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: options.systemPrompt }],
      },
      contents: buildGeminiConversationContents(options.userPrompt, options.historyTurns),
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
    throwIfAborted(options.signal);

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
    throwIfAborted(options.signal);
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

async function rewriteQueryForRetrieval(options: {
  geminiApiKey: string;
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
      geminiApiKey: options.geminiApiKey,
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
}): Promise<RetrievedChunk[]> {
  const { data: chunks, error: searchError } = await options.supabaseClient.rpc(
    "match_chunks",
    {
      query_embedding: options.embedding,
      match_threshold: options.threshold,
      match_count: options.count,
      user_id: options.userId,
      course_id_filter: options.courseId,
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
  geminiApiKey: string;
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
      geminiApiKey: options.geminiApiKey,
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

    const { message, conversationId, courseId } = await req.json() as ChatRequest;
    const trimmedMessage = message?.trim();

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
    const activeAcademicTermId = await getActiveAcademicTermId(supabaseClient);

    console.log(`Processing RAG chat for user ${user.id}: "${trimmedMessage.substring(0, 50)}..." in conversation ${activeConversationId}`);

    const { data: recentMessages, error: historyError } = await supabaseClient
      .from("messages")
      .select("role, content")
      .eq("conversation_id", activeConversationId)
      .order("created_at", { ascending: false })
      .limit(CONVERSATION_HISTORY_FETCH_LIMIT);

    if (historyError) {
      console.error("Failed to load conversation history:", historyError);
    }

    const priorMessages = [...(recentMessages || [])].reverse();
    const historyTurns = buildConversationHistoryTurns(priorMessages);
    const historyContext = buildHistoryContext(historyTurns);

    const rewrittenQuery = await rewriteQueryForRetrieval({
      geminiApiKey,
      studentQuestion: trimmedMessage,
      historyContext,
      signal: requestAbortController.signal,
    });

    const retrievalQueries = Array.from(
      new Set(
        [trimmedMessage, rewrittenQuery]
          .map((query) => query.trim())
          .filter((query) => query.length > 0)
      )
    );

    const embeddings = await Promise.all(
      retrievalQueries.map((query) => embedQuery(geminiApiKey, query, requestAbortController.signal))
    );

    throwIfAborted(requestAbortController.signal);

    const retrievedChunkGroups = await Promise.all(
      embeddings.map((embedding) =>
        retrieveChunkCandidates({
          supabaseClient,
          userId: user.id,
          courseId: activeCourseId,
          embedding,
          threshold: HIGH_RECALL_MATCH_THRESHOLD,
          count: HIGH_RECALL_MATCH_COUNT,
        })
      )
    );

    throwIfAborted(requestAbortController.signal);

    const highRecallChunks = dedupeRetrievedChunksByBestScore(retrievedChunkGroups.flat());
    const retrievedChunks = rerankRetrievedChunks(
      highRecallChunks,
      rewrittenQuery || trimmedMessage,
      FINAL_MATCH_COUNT
    );

    console.log(
      `Retrieved ${highRecallChunks.length} high-recall chunks from ${retrievalQueries.length} query variant(s); reranked to ${retrievedChunks.length}.`
    );

    let ragContext = "";
    if (retrievedChunks.length > 0) {
      ragContext = "\n\n## Relevant Course Materials:\n\n";
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

    const systemPrompt = `You are EduChat, an AI learning assistant for university students. Your role is to answer questions about course materials accurately and helpfully.

IMPORTANT GUIDELINES:
1. Base your answers on the provided course materials when available.
2. ALWAYS cite your sources using numbered tokens in this exact format: <<cite:1>>, <<cite:2>>.
3. Place citation tokens immediately after the sentence or claim they support.
4. If the information is not in the provided materials, say so clearly.
5. Use markdown formatting for better readability.
6. Be concise but thorough.
7. Do NOT output a "Sources" section. Only use inline citation tokens like <<cite:1>>.
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
12. Use prior conversation turns to resolve follow-up references ("this", "that", "it", "the previous example") before answering.

Citation format examples (follow exactly):
- "Virtual memory allows for larger address spaces <<cite:1>>."
- "The CPU schedules processes based on priority <<cite:2>>. This ensures efficiency <<cite:3>>."

${ragContext ? "The following are relevant excerpts from the course materials. Use these to answer the student's question:" : "No specific course materials were found for this query. Provide a helpful general response but note that this isn't from the course materials."}
${ragContext}`;

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

            const rawAnswer = await generateGeminiTextStream({
              geminiApiKey,
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
              geminiApiKey,
              question: trimmedMessage,
              rawAnswer,
              chunks: retrievedChunks,
              signal: requestAbortController.signal,
            });

            ensureStreamActive();

            const { data: userMessage, error: userMessageError } = await supabaseClient
              .from("messages")
              .insert({
                conversation_id: activeConversationId,
                role: "user",
                content: trimmedMessage,
              })
              .select("id")
              .single();

            if (userMessageError || !userMessage) {
              throw new Error(`Failed to save user message: ${userMessageError?.message || "Unknown error"}`);
            }

            ensureStreamActive();

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
              ensureStreamActive();

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

            ensureStreamActive();

            await supabaseClient
              .from("conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", activeConversationId);

            const queryCategory = classifyQueryCategory(trimmedMessage);
            const unresolvedReason = inferUnresolvedReason({
              retrievedChunkCount: retrievedChunks.length,
              citationCount: citedChunks.length,
              answer,
            });
            const unresolved = unresolvedReason !== null;

            ensureStreamActive();

            await insertQueryEvent(supabaseAdminClient, {
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
            });

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

            console.log(`Successfully generated response with ${citations.length} citations`);

            ensureStreamActive();
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
