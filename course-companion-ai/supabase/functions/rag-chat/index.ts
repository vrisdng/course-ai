import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMBEDDING_MODEL = "gemini-embedding-001";
const CHAT_MODEL = "gemini-3-flash-preview";
const CITATION_PIPELINE_VERSION = "2026-02-14-cite-token-rerank-v1";
const HIGH_RECALL_MATCH_THRESHOLD = 0.50;
const HIGH_RECALL_MATCH_COUNT = 18;
const FINAL_MATCH_COUNT = 6;
const RELEVANCE_FLOOR = 0.55;
const CITATION_TOKEN_PATTERN = "<<cite:(\\d+)>>";
const CONVERSATION_HISTORY_FETCH_LIMIT = 24;
const CONVERSATION_HISTORY_PROMPT_LIMIT = 14;
const CONVERSATION_HISTORY_CHAR_BUDGET = 9000;
const CONVERSATION_HISTORY_MESSAGE_CLIP = 850;
const MEMORY_CITATION_TOKEN_PATTERN = /<<\s*cite\s*:\s*[1-9]\d*\s*>>/gi;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ChatRequest {
  message: string;
  conversationId?: string;
  courseId?: string;
  selectedDocumentIds?: string[];
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

interface ResolvedSelectedMaterial {
  id: string;
  fileName: string;
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

function normalizeSelectedDocumentIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueIds = new Set<string>();

  for (const rawId of value) {
    if (typeof rawId !== "string") {
      continue;
    }

    const trimmedId = rawId.trim();
    if (!UUID_PATTERN.test(trimmedId)) {
      continue;
    }

    uniqueIds.add(trimmedId);
  }

  return Array.from(uniqueIds);
}

function formatDocumentNameList(materials: ResolvedSelectedMaterial[]): string {
  if (materials.length === 0) {
    return "the selected documents";
  }

  if (materials.length === 1) {
    return `"${materials[0].fileName}"`;
  }

  if (materials.length === 2) {
    return `"${materials[0].fileName}" and "${materials[1].fileName}"`;
  }

  return `${materials.length} selected documents`;
}

function buildSelectedDocumentEmptyAnswer(materials: ResolvedSelectedMaterial[]): string {
  return `I couldn't find enough information in ${formatDocumentNameList(materials)} to answer that from the selected documents alone.\n\n## Next step\n\nTry selecting additional documents or switching back to **All course documents** for a broader grounded answer.`;
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
  return scored.slice(0, topK).map((entry) => ({
    ...entry.chunk,
    relevance_score: entry.combinedScore,
  }));
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
  const materialGapPattern = /(not (?:in|from) (?:the )?(?:provided )?(?:selected )?(?:course )?(?:documents|materials)|not available in (?:the )?(?:provided )?(?:selected )?(?:course )?(?:documents|materials)|cannot find this in (?:the )?(?:selected )?(?:documents|materials))/;
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

    const {
      message,
      conversationId,
      courseId,
      selectedDocumentIds: rawSelectedDocumentIds,
    } = await req.json() as ChatRequest;
    const trimmedMessage = message?.trim();
    const selectedDocumentIds = normalizeSelectedDocumentIds(rawSelectedDocumentIds);

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
    const selectedMaterials = await resolveSelectedMaterials(
      supabaseClient,
      activeCourseId,
      selectedDocumentIds,
    );
    const selectedMaterialIds = selectedMaterials.map((material) => material.id);

    // Parallelize: academic term ID + conversation history + original query embedding
    const [activeAcademicTermId, { data: recentMessages, error: historyError }, originalEmbedding] = await Promise.all([
      getActiveAcademicTermId(supabaseClient),
      supabaseClient
        .from("messages")
        .select("role, content")
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: false })
        .limit(CONVERSATION_HISTORY_FETCH_LIMIT),
      embedQuery(geminiApiKey, trimmedMessage, requestAbortController.signal),
    ]);

    if (historyError) {
      console.error("Failed to load conversation history:", historyError);
    }

    console.log(`Processing RAG chat for user ${user.id}: "${trimmedMessage.substring(0, 50)}..." in conversation ${activeConversationId}`);

    const priorMessages = [...(recentMessages || [])].reverse();
    const historyTurns = buildConversationHistoryTurns(priorMessages);
    const historyContext = buildHistoryContext(historyTurns);

    throwIfAborted(requestAbortController.signal);

    const rewrittenQuery = await rewriteQueryForRetrieval({
      geminiApiKey,
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

    const retrievedChunks = rerankedChunks.filter(
      (c) => c.relevance_score >= relevanceFloor
    );

    console.log(
      `Retrieved ${highRecallChunks.length} high-recall chunks from ${retrievalQueries.length} query variant(s); reranked to ${rerankedChunks.length}; ${retrievedChunks.length} above relevance floor. Selected document filter count: ${selectedMaterialIds.length}.`
    );

    const hasSelectedDocumentFilter = selectedMaterials.length > 0;
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

    const systemPrompt = `You are EduChat, an AI learning assistant for university students.

Answer questions using the provided course materials when relevant. Format responses in clean markdown. Start with a direct answer, then elaborate with structure if needed.
${summaryInstruction}

FORMATTING: Every section title or topic heading MUST use ## markdown headings. Never write a heading as plain unformatted text — use **bold** for headings. Use **bold** for key terms and emphasis within paragraphs. Use bullet points for lists. Use markdown tables when presenting comparative or tabular data

CITATIONS: Cite sources inline using <<cite:1>>, <<cite:2>> etc. immediately after the claim they support. Do NOT add a "Sources" or "References" section at the end. Only use citation numbers that correspond to provided sources.

Examples:
- "Virtual memory allows for larger address spaces <<cite:1>>."
- "The CPU schedules processes based on priority <<cite:2>>. This ensures efficiency <<cite:3>>."

RELEVANCE: Before citing a source, verify it genuinely answers the question — not just that it shares keywords. If the question is outside the scope of the course materials, say so and suggest the student search online. Do not force-fit unrelated material.

Use prior conversation turns to resolve follow-up references like "this", "that", "it", or "the previous example".

${retrievalScopeInstruction}

${ragContext ? retrievalContextHeading : noResultsInstruction}
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

            if (hasSelectedDocumentFilter && retrievedChunks.length === 0) {
              const answer = buildSelectedDocumentEmptyAnswer(selectedMaterials);

              sendEvent("final", {
                answer,
                citations: [],
                conversationId: activeConversationId,
                meta: {
                  chatModel: CHAT_MODEL,
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
                chatModel: CHAT_MODEL,
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
