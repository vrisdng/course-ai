// Chunk dedup, lexical scoring, and reranking for rag-chat retrieval.
import { CHAT_SETTING_RANGES, DEFAULT_CHAT_SETTINGS, type ChatSettings } from "./chatSettings.ts";

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

// For summary questions over videos: spreads chunks across the timeline by
// dropping any that start within windowMs of an already-kept chunk. Chunks
// without a timestamp (documents) are always kept.
export function spreadAcrossTimeline<T extends { start_ms: number | null }>(chunks: T[], windowMs: number): T[] {
  const kept: T[] = [];
  for (const chunk of chunks) {
    const start = chunk.start_ms;
    if (typeof start !== "number") {
      kept.push(chunk);
      continue;
    }
    const overlaps = kept.some((other) => typeof other.start_ms === "number" && Math.abs(other.start_ms - start) < windowMs);
    if (!overlaps) kept.push(chunk);
  }
  return kept;
}

// ── Video / document balance ────────────────────────────────────────────
// A course can set what share of each search's source text comes from video
// transcripts versus documents (ChatSettings.videoSharePercent). The share is
// of the characters the model is shown (each passage counted up to
// sourceContextChars, as formatSourceBody clips it), not of the passage
// count: a long transcript window and a short slide passage are not worth the
// same. Cosine scores are left alone: they rank passages within a type and
// decide relevance, and are never treated as probabilities or rescaled.

export interface SourceTypeFields {
  material_type?: string | null;
  document_type?: string | null;
}

export interface SelectableChunk extends RerankableChunk, SourceTypeFields {
  start_ms: number | null;
}

// Video materials count as video; everything else (PDFs, slides, notes,
// uploaded transcripts, student documents) counts as a document.
export function isVideoSource(chunk: SourceTypeFields): boolean {
  return chunk.material_type === "video";
}

// Candidates fetched per search are doubled when balancing: match_chunks
// returns the top N across both types, so a dominant type could otherwise
// crowd the other out before the balance step ever sees it. The similarity
// threshold still applies to every candidate.
const BALANCED_CANDIDATE_MULTIPLIER = 2;

export function candidateCountForSearch(matchCount: number, settings: ChatSettings): number {
  if (settings.videoSharePercent === null) return matchCount;
  return Math.min(CHAT_SETTING_RANGES.matchCount.max, matchCount * BALANCED_CANDIDATE_MULTIPLIER);
}

export interface VideoShareOptions {
  count: number;
  videoSharePercent: number;
  charsPerSource: number;
}

// Floating-point slack when comparing how far two picks miss the target.
const SHARE_TIE_EPSILON = 1e-9;

// Picks up to `count` passages from `ranked` (best first, all already above
// the relevance floor) so the video share of their text lands as close to
// the target as the passages allow. Each step takes the next-best video or
// next-best document, whichever leaves the running share nearer the target;
// an equal miss goes to the more relevant passage. When one type runs out,
// the other fills the remaining slots, so 0% still uses video when no
// relevant document passage is left (and 100% documents). Nothing below the
// floor is ever added to reach the target. Returned in relevance order.
export function balanceByVideoShare<T extends RerankableChunk & SourceTypeFields>(
  ranked: T[],
  options: VideoShareOptions,
): T[] {
  const target = options.videoSharePercent / 100;
  const weight = (chunk: T) => Math.max(1, Math.min(chunk.chunk_text.length, options.charsPerSource));
  const videoRanks: number[] = [];
  const documentRanks: number[] = [];
  ranked.forEach((chunk, rank) => (isVideoSource(chunk) ? videoRanks : documentRanks).push(rank));

  const picked: number[] = [];
  let videoChars = 0;
  let totalChars = 0;
  let nextVideo = 0;
  let nextDocument = 0;
  while (picked.length < options.count && (nextVideo < videoRanks.length || nextDocument < documentRanks.length)) {
    const videoRank = videoRanks[nextVideo];
    const documentRank = documentRanks[nextDocument];
    let takeVideo: boolean;
    if (documentRank === undefined) {
      takeVideo = true;
    } else if (videoRank === undefined) {
      takeVideo = false;
    } else {
      const videoWeight = weight(ranked[videoRank]);
      const documentWeight = weight(ranked[documentRank]);
      const missIfVideo = Math.abs((videoChars + videoWeight) / (totalChars + videoWeight) - target);
      const missIfDocument = Math.abs(videoChars / (totalChars + documentWeight) - target);
      takeVideo = Math.abs(missIfVideo - missIfDocument) <= SHARE_TIE_EPSILON
        ? videoRank < documentRank
        : missIfVideo < missIfDocument;
    }
    const rank = takeVideo ? videoRanks[nextVideo++] : documentRanks[nextDocument++];
    const chars = weight(ranked[rank]);
    if (takeVideo) videoChars += chars;
    totalChars += chars;
    picked.push(rank);
  }
  return picked.sort((a, b) => a - b).map((rank) => ranked[rank]);
}

export interface SearchSelectionOptions {
  retrieval: RetrievalSettings;
  settings: ChatSettings;
  isSummaryQuery: boolean;
}

// From one search's candidates to the sources the model is shown: dedupe,
// rerank, spread video across the timeline for summaries, apply the
// relevance floor, and keep finalCount. With the video share off this is the
// original relevance-only ranking; with it on, the finalCount slots are
// filled by balanceByVideoShare from every relevant candidate.
export function selectSearchResults<T extends SelectableChunk>(
  candidates: T[],
  query: string,
  options: SearchSelectionOptions,
): T[] {
  const { retrieval, settings, isSummaryQuery } = options;
  const unique = dedupeRetrievedChunksByBestScore(candidates);
  const share = settings.videoSharePercent;
  const isRelevant = (chunk: T) => chunk.relevance_score >= retrieval.relevanceFloor;

  if (share === null) {
    let ranked = rerankRetrievedChunks(unique, query, retrieval.finalCount, settings.semanticWeight);
    if (isSummaryQuery) ranked = spreadAcrossTimeline(ranked, settings.videoSpreadWindowMs);
    return ranked.filter(isRelevant);
  }

  let ranked = rerankRetrievedChunks(unique, query, unique.length, settings.semanticWeight);
  if (isSummaryQuery) ranked = spreadAcrossTimeline(ranked, settings.videoSpreadWindowMs);
  return balanceByVideoShare(ranked.filter(isRelevant), {
    count: retrieval.finalCount,
    videoSharePercent: share,
    charsPerSource: settings.sourceContextChars,
  });
}
