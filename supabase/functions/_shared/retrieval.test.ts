import { describe, expect, it } from "vitest";

import {
  dedupeRetrievedChunksByBestScore,
  getRetrievalSettings,
  lexicalOverlapScore,
  rerankRetrievedChunks,
  tokenizeForLexicalScore,
} from "./retrieval.ts";

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
      matchThreshold: 0.40,
      matchCount: 24,
      relevanceFloor: 0.40,
      finalCount: 10,
    });
  });

  it("keeps the stricter defaults when all course documents are available", () => {
    expect(getRetrievalSettings({ isSummaryQuery: false, hasSelectedDocumentFilter: false })).toEqual({
      matchThreshold: 0.50,
      matchCount: 18,
      relevanceFloor: 0.55,
      finalCount: 10,
    });
  });

  it("prioritizes broad summary retrieval regardless of document scope", () => {
    expect(getRetrievalSettings({ isSummaryQuery: true, hasSelectedDocumentFilter: true })).toEqual({
      matchThreshold: 0.40,
      matchCount: 30,
      relevanceFloor: 0.40,
      finalCount: 10,
    });
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

  it("clamps out-of-range relevance scores before blending", () => {
    const chunks = [{ id: "a", chunk_text: "text", relevance_score: 5 }];
    const result = rerankRetrievedChunks(chunks, "text", 1);
    expect(result[0].relevance_score).toBeLessThanOrEqual(1);
  });
});
