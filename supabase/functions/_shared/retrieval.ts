// Chunk dedup, lexical scoring, and reranking for rag-chat retrieval.
import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from "./chatSettings.ts";

export interface RerankableChunk {
  id: string;
  chunk_text: string;
  relevance_score: number;
}

export interface RetrievalSettings {
  matchThreshold: number;
  matchCount: number;
  relevanceFloor: number;
  finalCount: number;
}

export function getRetrievalSettings(
  options: {
    isSummaryQuery: boolean;
    hasSelectedDocumentFilter: boolean;
  },
  settings: ChatSettings = DEFAULT_CHAT_SETTINGS,
): RetrievalSettings {
  // An explicit selection is already a strong relevance constraint. Always
  // return its best embedded chunks and use reranking/model judgment instead
  // of refusing solely because an arbitrary cosine cutoff was not reached.
  if (options.hasSelectedDocumentFilter) {
    return {
      matchThreshold: -2,
      matchCount: options.isSummaryQuery ? settings.summaryMatchCount : settings.filteredMatchCount,
      relevanceFloor: -1,
      finalCount: settings.finalCount,
    };
  }

  if (options.isSummaryQuery) {
    return {
      matchThreshold: settings.summaryMatchThreshold,
      matchCount: settings.summaryMatchCount,
      relevanceFloor: settings.summaryRelevanceFloor,
      finalCount: settings.finalCount,
    };
  }

  return {
    matchThreshold: settings.matchThreshold,
    matchCount: settings.matchCount,
    relevanceFloor: settings.relevanceFloor,
    finalCount: settings.finalCount,
  };
}

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

export function tokenizeForLexicalScore(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !LEXICAL_STOP_WORDS.has(token));
}

export function lexicalOverlapScore(query: string, chunkText: string): number {
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

export function dedupeRetrievedChunksByBestScore<T extends RerankableChunk>(chunks: T[]): T[] {
  const byChunkId = new Map<string, T>();

  for (const chunk of chunks) {
    const existing = byChunkId.get(chunk.id);
    if (!existing || chunk.relevance_score > existing.relevance_score) {
      byChunkId.set(chunk.id, chunk);
    }
  }

  return Array.from(byChunkId.values());
}

export function rerankRetrievedChunks<T extends RerankableChunk>(
  chunks: T[],
  query: string,
  topK: number,
  semanticWeight = DEFAULT_CHAT_SETTINGS.semanticWeight,
): T[] {
  const scored = chunks.map((chunk) => {
    const semantic = Math.max(0, Math.min(1, chunk.relevance_score));
    const lexical = lexicalOverlapScore(query, chunk.chunk_text);
    const combinedScore = semantic * semanticWeight + lexical * (1 - semanticWeight);
    return { chunk, semantic, combinedScore };
  });

  scored.sort((a, b) => b.combinedScore - a.combinedScore);
  return scored.slice(0, topK).map((entry) => ({
    ...entry.chunk,
    // Lexical overlap determines ordering only. Keep relevance_score on the
    // original cosine-similarity scale so downstream semantic thresholds do
    // not discard good paraphrase matches simply for lacking exact keywords.
    relevance_score: entry.semantic,
  }));
}
