import { describe, expect, it } from "vitest";
import { buildTranscriptChunks, groupWordsIntoSegments, isStoredVideoPath } from "./pipeline";

describe("stored video transcription", () => {
  it("rejects empty, bucket-prefixed and traversal paths", () => {
    expect(isStoredVideoPath("course/lecture.mp4")).toBe(true);
    expect(isStoredVideoPath("course-materials/course/lecture.mp4")).toBe(false);
    expect(isStoredVideoPath("../lecture.mp4")).toBe(false);
    expect(isStoredVideoPath("https://example.com/lecture.mp4")).toBe(false);
  });

  it("keeps speech timeline gaps and cuts at sentence boundaries", () => {
    const segments = groupWordsIntoSegments([
      { text: "Hello", start: 1_000, end: 1_300, confidence: 0.9 },
      { text: "world.", start: 1_310, end: 1_700, confidence: 0.8 },
      { text: "Next", start: 5_000, end: 5_300, confidence: 0.9 },
      { text: "sentence.", start: 5_310, end: 5_900, confidence: 0.9 },
    ]);
    expect(segments).toEqual([
      expect.objectContaining({ startMs: 1_000, endMs: 1_700, text: "Hello world." }),
      expect.objectContaining({ startMs: 5_000, endMs: 5_900, text: "Next sentence." }),
    ]);
  });

  it("builds ordered RAG chunks with seekable bounds", () => {
    const segments = [
      { startMs: 0, endMs: 1000, text: "First sentence." },
      { startMs: 2000, endMs: 3000, text: "Second sentence." },
    ];
    expect(buildTranscriptChunks(segments)).toEqual([
      { startMs: 0, endMs: 3000, text: "First sentence. Second sentence." },
    ]);
  });

  it("bounds a run-on transcript segment and preserves the next word's time", () => {
    const words = Array.from({ length: 20 }, (_, index) => ({
      text: `word${index}`, start: index * 1000, end: index * 1000 + 400, confidence: 1,
    }));
    const segments = groupWordsIntoSegments(words);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startMs: 0, endMs: 15_400 });
    expect(segments[1]).toMatchObject({ startMs: 16_000, endMs: 19_400 });
  });
});
