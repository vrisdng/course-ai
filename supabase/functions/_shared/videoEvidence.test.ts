import { describe, expect, it } from "vitest";

import { parseVideoEvidenceSelection, type VideoEvidenceCandidate } from "./videoEvidence.ts";

const candidate: VideoEvidenceCandidate = {
  citation: 1,
  materialId: "video-1",
  segments: [
    { id: "filler", segmentIndex: 0, startMs: 4_458_000, endMs: 4_460_000, text: "Yes, I think most of you got it correct." },
    { id: "calcination", segmentIndex: 1, startMs: 4_461_000, endMs: 4_465_000, text: "Primary emission hotspot is the calcination reaction of limestone." },
    { id: "smaller", segmentIndex: 2, startMs: 4_467_000, endMs: 4_470_000, text: "Whereas the other impact are much smaller." },
  ],
};

describe("parseVideoEvidenceSelection", () => {
  it("maps selected transcript indices to verified IDs and immutable snapshots", () => {
    const selected = parseVideoEvidenceSelection(
      JSON.stringify({ citations: [{ citation: 1, segmentIndices: [1, 2] }] }),
      [candidate],
    );
    expect(selected.get(1)).toEqual(candidate.segments.slice(1));
    expect(selected.get(1)?.map((segment) => segment.id)).not.toContain("filler");
  });

  it("rejects invented indices and citations instead of persisting them", () => {
    const selected = parseVideoEvidenceSelection(
      JSON.stringify({ citations: [
        { citation: 1, segmentIndices: [1, 99, 1] },
        { citation: 2, segmentIndices: [0] },
      ] }),
      [candidate],
    );
    expect(selected.get(1)).toEqual([candidate.segments[1]]);
    expect(selected.has(2)).toBe(false);
  });

  it("returns no exact evidence when model output is malformed", () => {
    expect(parseVideoEvidenceSelection("not json", [candidate]).size).toBe(0);
    expect(parseVideoEvidenceSelection('{"citations":[{"citation":1,"segmentIndices":"1"}]}', [candidate]).size).toBe(0);
  });
});
