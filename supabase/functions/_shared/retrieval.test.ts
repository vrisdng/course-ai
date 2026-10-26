import { describe, expect, it } from "vitest";

import {
  balanceByVideoShare,
  candidateCountForSearch,
  dedupeRetrievedChunksByBestScore,
  getRetrievalSettings,
  isVideoSource,
  lexicalOverlapScore,
  rerankRetrievedChunks,
  selectSearchResults,
  spreadAcrossTimeline,
  tokenizeForLexicalScore,
  type RetrievalSettings,
} from "./retrieval.ts";
import { resolveChatSettings } from "./chatSettings.ts";

describe("tokenizeForLexicalScore", () => {
  it("lowercases, strips punctuation, and drops short/stop words", () => {
    expect(tokenizeForLexicalScore("The Quick, Fox! runs.")).toEqual(["quick", "fox", "runs"]);
  });
});

describe("lexicalOverlapScore", () => {
  it("returns 1 when every query token appears in the chunk", () => {
    expect(lexicalOverlapScore("virtual memory paging", "virtual memory uses paging")).toBe(1);
  });

  it("returns 0 when no query tokens appear", () => {
    expect(lexicalOverlapScore("virtual memory", "completely unrelated content")).toBe(0);
  });

  it("returns 0 for an empty query", () => {
    expect(lexicalOverlapScore("", "some chunk text")).toBe(0);
  });
});

describe("dedupeRetrievedChunksByBestScore", () => {
  it("keeps only the highest-scoring chunk per id", () => {
    const chunks = [
      { id: "a", chunk_text: "x", relevance_score: 0.4 },
      { id: "a", chunk_text: "x", relevance_score: 0.9 },
      { id: "b", chunk_text: "y", relevance_score: 0.5 },
    ];
    const result = dedupeRetrievedChunksByBestScore(chunks);
    expect(result).toHaveLength(2);
    expect(result.find((c) => c.id === "a")?.relevance_score).toBe(0.9);
  });
});

describe("getRetrievalSettings", () => {
  it("uses a wider semantic search for an explicit document selection", () => {
    expect(getRetrievalSettings({ isSummaryQuery: false, hasSelectedDocumentFilter: true })).toEqual({
      matchThreshold: -2,
      matchCount: 24,
      relevanceFloor: -1,
      finalCount: 10,
    });
  });

  it("keeps the stricter defaults when all course documents are available", () => {
    expect(getRetrievalSettings({ isSummaryQuery: false, hasSelectedDocumentFilter: false })).toEqual({
      matchThreshold: 0.20,
      matchCount: 18,
      relevanceFloor: 0.20,
      finalCount: 10,
    });
  });

  it("relaxes thresholds for broad summary queries across all course documents", () => {
    expect(getRetrievalSettings({ isSummaryQuery: true, hasSelectedDocumentFilter: false })).toEqual({
      matchThreshold: 0.15,
      matchCount: 30,
      relevanceFloor: 0.15,
      finalCount: 10,
    });
  });

  it("prioritizes broad summary retrieval regardless of document scope", () => {
    expect(getRetrievalSettings({ isSummaryQuery: true, hasSelectedDocumentFilter: true })).toEqual({
      matchThreshold: -2,
      matchCount: 30,
      relevanceFloor: -1,
      finalCount: 10,
    });
  });

  it("reads thresholds and counts from course chat settings", () => {
    const settings = resolveChatSettings({
      match_threshold: 0.3,
      summary_match_threshold: 0.25,
      match_count: 20,
      summary_match_count: 40,
      filtered_match_count: 26,
      relevance_floor: 0.35,
      summary_relevance_floor: 0.2,
      final_count: 6,
    });
    expect(getRetrievalSettings({ isSummaryQuery: false, hasSelectedDocumentFilter: false }, settings)).toEqual({
      matchThreshold: 0.3,
      matchCount: 20,
      relevanceFloor: 0.35,
      finalCount: 6,
    });
    expect(getRetrievalSettings({ isSummaryQuery: true, hasSelectedDocumentFilter: false }, settings)).toEqual({
      matchThreshold: 0.25,
      matchCount: 40,
      relevanceFloor: 0.2,
      finalCount: 6,
    });
    expect(getRetrievalSettings({ isSummaryQuery: false, hasSelectedDocumentFilter: true }, settings)).toEqual({
      matchThreshold: -2,
      matchCount: 26,
      relevanceFloor: -1,
      finalCount: 6,
    });
    expect(getRetrievalSettings({ isSummaryQuery: true, hasSelectedDocumentFilter: true }, settings).matchCount).toBe(40);
  });
});

describe("rerankRetrievedChunks", () => {
  it("preserves semantic relevance scores used by the final relevance floor", () => {
    const chunks = [
      {
        id: "semantic-match",
        chunk_text: "A paraphrased explanation without shared query terms",
        relevance_score: 0.61,
      },
    ];

    const result = rerankRetrievedChunks(chunks, "corporate emissions accounting", 1);

    expect(result[0].relevance_score).toBe(0.61);
  });

  it("boosts chunks with high lexical overlap over pure semantic score", () => {
    const chunks = [
      { id: "semantic-only", chunk_text: "completely unrelated filler text", relevance_score: 0.9 },
      { id: "lexical-match", chunk_text: "virtual memory paging algorithm", relevance_score: 0.6 },
    ];
    const result = rerankRetrievedChunks(chunks, "virtual memory paging", 2);
    expect(result[0].id).toBe("lexical-match");
  });

  it("limits results to topK", () => {
    const chunks = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      chunk_text: "text",
      relevance_score: i / 5,
    }));
    expect(rerankRetrievedChunks(chunks, "text", 2)).toHaveLength(2);
  });

  it("orders purely by semantic score when the semantic weight is 1", () => {
    const chunks = [
      { id: "semantic-only", chunk_text: "completely unrelated filler text", relevance_score: 0.9 },
      { id: "lexical-match", chunk_text: "virtual memory paging algorithm", relevance_score: 0.6 },
    ];
    const result = rerankRetrievedChunks(chunks, "virtual memory paging", 2, 1);
    expect(result[0].id).toBe("semantic-only");
  });

  it("clamps out-of-range relevance scores before blending", () => {
    const chunks = [{ id: "a", chunk_text: "text", relevance_score: 5 }];
    const result = rerankRetrievedChunks(chunks, "text", 1);
    expect(result[0].relevance_score).toBeLessThanOrEqual(1);
  });
});

describe("spreadAcrossTimeline", () => {
  const at = (id: string, startMs: number | null) => ({ id, start_ms: startMs });

  it("drops video chunks that start within the window of an already-kept one", () => {
    const kept = spreadAcrossTimeline([at("a", 0), at("b", 30_000), at("c", 70_000), at("d", 100_000)], 60_000);
    expect(kept.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("keeps chunks without timestamps (documents) untouched", () => {
    const kept = spreadAcrossTimeline([at("doc1", null), at("a", 0), at("doc2", null), at("b", 10_000)], 60_000);
    expect(kept.map((c) => c.id)).toEqual(["doc1", "a", "doc2"]);
  });

  it("keeps everything when the window is zero", () => {
    const kept = spreadAcrossTimeline([at("a", 0), at("b", 0)], 0);
    expect(kept.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

// Fixtures for the video/document balance. Scores are cosine similarities;
// with semantic_weight 1 the rerank order is the score order, so each test
// reads as "these passages, in this relevance order".
interface Passage {
  id: string;
  chunk_text: string;
  relevance_score: number;
  start_ms: number | null;
  material_type?: string;
  document_type?: string;
}

const video = (id: string, score: number, chars = 400): Passage => ({
  id,
  chunk_text: "v".repeat(chars),
  relevance_score: score,
  start_ms: Number(id.replace(/\D/g, "") || 0) * 120_000,
  material_type: "video",
});
const doc = (id: string, score: number, chars = 400): Passage => ({
  id,
  chunk_text: "d".repeat(chars),
  relevance_score: score,
  start_ms: null,
  material_type: "pdf",
});
// Descending scores from `top`, so the first passage is the most relevant.
const videos = (n: number, top = 0.9, chars = 400) => Array.from({ length: n }, (_, i) => video(`v${i + 1}`, top - i * 0.005, chars));
const docs = (n: number, top = 0.6, chars = 400) => Array.from({ length: n }, (_, i) => doc(`d${i + 1}`, top - i * 0.005, chars));

const NORMAL: RetrievalSettings = { matchThreshold: 0.2, matchCount: 18, relevanceFloor: 0.2, finalCount: 10 };
const settingsWith = (videoSharePercent: number | null, extra: Record<string, number> = {}) =>
  resolveChatSettings({ video_share_percent: videoSharePercent, semantic_weight: 1, ...extra });
const select = (candidates: Passage[], videoSharePercent: number | null, retrieval = NORMAL, isSummaryQuery = false) =>
  selectSearchResults(candidates, "query", { retrieval, settings: settingsWith(videoSharePercent), isSummaryQuery });
const kinds = (chunks: Passage[]) => ({
  video: chunks.filter((c) => c.material_type === "video").length,
  document: chunks.filter((c) => c.material_type !== "video").length,
});

describe("isVideoSource", () => {
  it("counts only video materials as video; student documents and other files are documents", () => {
    expect(isVideoSource({ material_type: "video" })).toBe(true);
    expect(isVideoSource({ material_type: "pdf" })).toBe(false);
    expect(isVideoSource({ material_type: "transcript" })).toBe(false);
    expect(isVideoSource({ document_type: "pdf" })).toBe(false);
    expect(isVideoSource({})).toBe(false);
  });
});

describe("candidateCountForSearch", () => {
  it("fetches the configured count when the balance is off", () => {
    expect(candidateCountForSearch(18, settingsWith(null))).toBe(18);
  });

  it("fetches twice as many when balancing, so a less common type is not crowded out before the balance step", () => {
    expect(candidateCountForSearch(18, settingsWith(30))).toBe(36);
    expect(candidateCountForSearch(18, settingsWith(0))).toBe(36);
  });

  it("never asks for more than the largest allowed candidate count", () => {
    expect(candidateCountForSearch(60, settingsWith(50))).toBe(100);
  });
});

describe("selectSearchResults with the balance off (default)", () => {
  it("is exactly the previous pipeline: rerank to finalCount, then the relevance floor", () => {
    const candidates = [...videos(14), ...docs(6), doc("weak", 0.1)];
    const settings = resolveChatSettings({});
    const legacy = rerankRetrievedChunks(dedupeRetrievedChunksByBestScore(candidates), "query", NORMAL.finalCount, settings.semanticWeight)
      .filter((c) => c.relevance_score >= NORMAL.relevanceFloor);
    expect(selectSearchResults(candidates, "query", { retrieval: NORMAL, settings, isSummaryQuery: false })).toEqual(legacy);
  });

  it("lets the more similar type take every slot", () => {
    expect(kinds(select([...videos(14), ...docs(6)], null))).toEqual({ video: 10, document: 0 });
  });
});

describe("selectSearchResults with a video share", () => {
  it("splits the sources evenly at 50% when both types have enough relevant passages", () => {
    const result = select([...videos(14), ...docs(14)], 50);
    expect(kinds(result)).toEqual({ video: 5, document: 5 });
    // The best of each type, not arbitrary ones.
    expect(result.map((c) => c.id).sort()).toEqual(["d1", "d2", "d3", "d4", "d5", "v1", "v2", "v3", "v4", "v5"]);
  });

  it("returns the chosen sources in relevance order, so source numbers still follow relevance", () => {
    const result = select([...docs(14, 0.9), ...videos(14, 0.6)], 30);
    const scores = result.map((c) => c.relevance_score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("hits intermediate targets by share of text", () => {
    expect(kinds(select([...videos(14), ...docs(14)], 30))).toEqual({ video: 3, document: 7 });
    expect(kinds(select([...videos(14), ...docs(14)], 80))).toEqual({ video: 8, document: 2 });
  });

  it("at 0% uses only documents while relevant documents remain", () => {
    expect(kinds(select([...videos(14), ...docs(14)], 0))).toEqual({ video: 0, document: 10 });
  });

  it("at 100% uses only video while relevant video remains", () => {
    expect(kinds(select([...videos(14), ...docs(14, 0.95)], 100))).toEqual({ video: 10, document: 0 });
  });

  it("fills the rest with the other type when one type runs out of relevant passages", () => {
    expect(kinds(select([...videos(14), ...docs(3)], 0))).toEqual({ video: 7, document: 3 });
    expect(kinds(select([...videos(2), ...docs(14)], 100))).toEqual({ video: 2, document: 8 });
    expect(kinds(select([...videos(2), ...docs(14)], 50))).toEqual({ video: 2, document: 8 });
  });

  it("returns fewer sources rather than relevance-failing ones to hit the target", () => {
    const belowFloor = videos(10, 0.15);
    const result = select([...belowFloor, ...docs(4)], 100);
    expect(kinds(result)).toEqual({ video: 0, document: 4 });
    expect(result.every((c) => c.relevance_score >= NORMAL.relevanceFloor)).toBe(true);
  });

  it("returns nothing when nothing is relevant, whatever the share", () => {
    expect(select([...videos(5, 0.1), ...docs(5, 0.1)], 50)).toEqual([]);
  });

  it("measures the share by text length, so long video passages do not swamp short document passages", () => {
    // Video transcript windows are long, slide passages short.
    const result = select([...videos(14, 0.9, 1300), ...docs(20, 0.6, 260)], 50, { ...NORMAL, finalCount: 10 });
    const videoChars = result.filter(isVideoSource).reduce((sum, c) => sum + c.chunk_text.length, 0);
    const totalChars = result.reduce((sum, c) => sum + c.chunk_text.length, 0);
    expect(result).toHaveLength(10);
    expect(kinds(result).document).toBeGreaterThan(kinds(result).video);
    expect(videoChars / totalChars).toBeGreaterThan(0.4);
    expect(videoChars / totalChars).toBeLessThan(0.6);
  });

  it("counts a passage at most at the characters the model is shown", () => {
    // 5000-char videos clipped to 1300, like formatSourceBody does: same
    // split as equal-length passages.
    const settings = settingsWith(50, { source_context_chars: 1300 });
    const longVideos = videos(14, 0.9, 5000);
    const result = selectSearchResults([...longVideos, ...docs(14, 0.6, 1300)], "query", { retrieval: NORMAL, settings, isSummaryQuery: false });
    expect(kinds(result)).toEqual({ video: 5, document: 5 });
  });

  it("is deterministic and breaks an even split by relevance", () => {
    const candidates = [...docs(14, 0.6), ...videos(14, 0.9)];
    const first = select(candidates, 50);
    expect(select([...candidates], 50)).toEqual(first);
    // With one slot at 50% either type misses the target equally; the more
    // relevant passage wins.
    const oneSlot = { ...NORMAL, finalCount: 1 };
    expect(select(candidates, 50, oneSlot).map((c) => c.id)).toEqual(["v1"]);
    expect(select([...docs(14, 0.9), ...videos(14, 0.6)], 50, oneSlot).map((c) => c.id)).toEqual(["d1"]);
  });

  it("respects the student's document selection scope: only candidates from the search are returned", () => {
    const selected: RetrievalSettings = { matchThreshold: -2, matchCount: 24, relevanceFloor: -1, finalCount: 10 };
    const candidates = [...videos(3, 0.05), ...docs(2, 0.02)];
    const result = select(candidates, 100, selected);
    expect(result.map((c) => c.id).sort()).toEqual(candidates.map((c) => c.id).sort());
  });

  it("still spreads video passages across the timeline for summaries", () => {
    // v2 starts 10s after v1 (inside the 60s window); v3 is minutes later.
    const clustered = [video("v1", 0.9), { ...video("v2", 0.89), start_ms: 130_000 }, video("v3", 0.88), ...docs(10)];
    const result = select(clustered, 100, NORMAL, true);
    expect(result.map((c) => c.id)).not.toContain("v2");
    expect(result.map((c) => c.id)).toEqual(expect.arrayContaining(["v1", "v3"]));
  });

  it("keeps a duplicate chunk once, at its best score", () => {
    const result = select([video("v1", 0.5), video("v1", 0.9), ...docs(3)], 50);
    expect(result.filter((c) => c.id === "v1")).toHaveLength(1);
  });
});

describe("balanceByVideoShare", () => {
  it("never returns more than the requested count", () => {
    expect(balanceByVideoShare([...videos(5), ...docs(5)], { count: 3, videoSharePercent: 50, charsPerSource: 1300 })).toHaveLength(3);
  });

  it("returns everything in relevance order when there is room for all of it", () => {
    const ranked = [video("v1", 0.9), doc("d1", 0.8), video("v2", 0.7)];
    expect(balanceByVideoShare(ranked, { count: 10, videoSharePercent: 0, charsPerSource: 1300 })).toEqual(ranked);
  });
});
