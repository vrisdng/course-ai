// Chunk dedup, lexical scoring, and reranking for rag-chat retrieval.
export interface RerankableChunk {
  id: string;
  chunk_text: string;
  relevance_score: number;
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

export function rerankRetrievedChunks<T extends RerankableChunk>(chunks: T[], query: string, topK: number): T[] {
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
