import { describe, expect, it } from "vitest";

import {
  buildSelectedDocumentEmptyAnswer,
  classifyQueryCategory,
  formatDocumentNameList,
  inferUnresolvedReason,
  isLikelyAmbiguousQuestion,
  normalizeSelectedDocumentIds,
  resolveChatModelTier,
} from "./query.ts";

describe("resolveChatModelTier", () => {
  it("passes through valid tiers", () => {
    expect(resolveChatModelTier("smart")).toBe("smart");
    expect(resolveChatModelTier("pro")).toBe("pro");
  });

  it("defaults invalid or missing tiers to fast", () => {
    expect(resolveChatModelTier("bogus")).toBe("fast");
    expect(resolveChatModelTier(undefined)).toBe("fast");
  });
});

describe("normalizeSelectedDocumentIds", () => {
  const validId = "123e4567-e89b-12d3-a456-426614174000";

  it("keeps only valid UUIDs and dedupes", () => {
    expect(normalizeSelectedDocumentIds([validId, validId, "not-a-uuid"])).toEqual([validId]);
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeSelectedDocumentIds(null)).toEqual([]);
    expect(normalizeSelectedDocumentIds("nope")).toEqual([]);
  });
});

describe("formatDocumentNameList", () => {
  it("handles zero, one, two, and many materials", () => {
    expect(formatDocumentNameList([])).toBe("the selected documents");
    expect(formatDocumentNameList([{ id: "1", fileName: "A.pdf" }])).toBe('"A.pdf"');
    expect(
      formatDocumentNameList([
        { id: "1", fileName: "A.pdf" },
        { id: "2", fileName: "B.pdf" },
      ])
    ).toBe('"A.pdf" and "B.pdf"');
    expect(
      formatDocumentNameList([
        { id: "1", fileName: "A.pdf" },
        { id: "2", fileName: "B.pdf" },
        { id: "3", fileName: "C.pdf" },
      ])
    ).toBe("3 selected documents");
  });
});

describe("buildSelectedDocumentEmptyAnswer", () => {
  it("mentions the selected document name", () => {
    const answer = buildSelectedDocumentEmptyAnswer([{ id: "1", fileName: "Lecture.pdf" }]);
    expect(answer).toContain('"Lecture.pdf"');
  });
});

describe("isLikelyAmbiguousQuestion", () => {
  it("is not ambiguous when there is no prior history", () => {
    expect(isLikelyAmbiguousQuestion("what about this", "")).toBe(false);
  });

  it("flags short follow-up questions when history exists", () => {
    expect(isLikelyAmbiguousQuestion("what about that", "Student: earlier question")).toBe(true);
  });

  it("flags pronoun references regardless of length", () => {
    const longQuestion = "Could you go into more detail about how it actually works in practice here";
    expect(isLikelyAmbiguousQuestion(longQuestion, "Student: earlier question")).toBe(true);
  });

  it("does not flag a clear, self-contained question", () => {
    const question = "What is the difference between TCP and UDP in terms of reliability guarantees?";
    expect(isLikelyAmbiguousQuestion(question, "Student: earlier question")).toBe(false);
  });
});

describe("classifyQueryCategory", () => {
  it("classifies comparison questions", () => {
    expect(classifyQueryCategory("What is the difference between X and Y?")).toBe("comparison");
  });

  it("classifies how-to questions", () => {
    expect(classifyQueryCategory("How do I implement a binary search?")).toBe("how_to_process");
  });

  it("classifies calculation questions", () => {
    expect(classifyQueryCategory("Calculate the derivative of x^2")).toBe("calculation");
  });

  it("classifies troubleshooting questions", () => {
    expect(classifyQueryCategory("My code is failing with a null pointer error")).toBe("troubleshooting");
  });

  it("classifies definition questions", () => {
    expect(classifyQueryCategory("What is polymorphism?")).toBe("definition_concept");
  });

  it("falls back to other for unmatched text", () => {
    expect(classifyQueryCategory("")).toBe("other");
    expect(classifyQueryCategory("hello there")).toBe("other");
  });
});

describe("inferUnresolvedReason", () => {
  it("flags no_retrieval when nothing was retrieved", () => {
    expect(inferUnresolvedReason({ retrievedChunkCount: 0, citationCount: 0, answer: "" })).toBe(
      "no_retrieval"
    );
  });

  it("flags no_citations when chunks were retrieved but nothing was cited", () => {
    expect(inferUnresolvedReason({ retrievedChunkCount: 3, citationCount: 0, answer: "some answer" })).toBe(
      "no_citations"
    );
  });

  it("flags insufficient_materials when the answer says materials don't cover it", () => {
    const result = inferUnresolvedReason({
      retrievedChunkCount: 3,
      citationCount: 1,
      answer: "This is not available in the selected documents.",
    });
    expect(result).toBe("insufficient_materials");
  });

  it("returns null for a normally resolved answer", () => {
    const result = inferUnresolvedReason({
      retrievedChunkCount: 3,
      citationCount: 2,
      answer: "Here is the answer with citations.",
    });
    expect(result).toBeNull();
  });
});
