import { describe, expect, it } from "vitest";
import {
  formatPlaceLabel,
  groupChunksIntoPlaces,
  placeKey,
  toPlaceFilters,
  type MatchedChunk,
} from "./analyticsPlaces.ts";

const PDF = "pdf-1";
const VIDEO = "video-1";

function chunk(overrides: Partial<MatchedChunk>): MatchedChunk {
  return {
    chunk_id: crypto.randomUUID(),
    material_id: PDF,
    file_name: "Recursion.pdf",
    file_type: "pdf",
    page_number: 3,
    start_ms: null,
    end_ms: null,
    snippet: "text",
    similarity: 0.5,
    ...overrides,
  };
}

describe("groupChunksIntoPlaces", () => {
  it("groups document chunks by material and page, keeping the best match", () => {
    const places = groupChunksIntoPlaces([
      chunk({ page_number: 3, similarity: 0.4, snippet: "weaker" }),
      chunk({ page_number: 3, similarity: 0.6, snippet: "stronger" }),
      chunk({ page_number: 5, similarity: 0.5 }),
    ]);

    expect(places).toHaveLength(2);
    expect(places[0]).toMatchObject({
      materialId: PDF, pageNumber: 3, startMs: null, endMs: null,
      similarity: 0.6, snippet: "stronger", chunkCount: 2,
    });
    expect(places[1]).toMatchObject({ pageNumber: 5, chunkCount: 1 });
  });

  it("merges overlapping or nearby video chunks into one time range", () => {
    const places = groupChunksIntoPlaces([
      chunk({ material_id: VIDEO, file_type: "video", page_number: null, start_ms: 60_000, end_ms: 90_000, similarity: 0.5 }),
      chunk({ material_id: VIDEO, file_type: "video", page_number: null, start_ms: 100_000, end_ms: 130_000, similarity: 0.45 }),
      chunk({ material_id: VIDEO, file_type: "video", page_number: null, start_ms: 600_000, end_ms: 630_000, similarity: 0.42 }),
    ]);

    expect(places.map((place) => [place.startMs, place.endMs, place.chunkCount])).toEqual([
      [60_000, 130_000, 2],
      [600_000, 630_000, 1],
    ]);
  });

  it("orders places by their best similarity", () => {
    const places = groupChunksIntoPlaces([
      chunk({ page_number: 1, similarity: 0.3 }),
      chunk({ material_id: VIDEO, file_type: "video", page_number: null, start_ms: 0, end_ms: 30_000, similarity: 0.7 }),
      chunk({ page_number: 2, similarity: 0.5 }),
    ]);
    expect(places.map((place) => place.similarity)).toEqual([0.7, 0.5, 0.3]);
  });

  it("treats a document without pages as one place", () => {
    const places = groupChunksIntoPlaces([
      chunk({ page_number: null, similarity: 0.4 }),
      chunk({ page_number: null, similarity: 0.5 }),
    ]);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ pageNumber: null, chunkCount: 2 });
  });

  it("gives each place a stable key", () => {
    const [place] = groupChunksIntoPlaces([chunk({ page_number: 7 })]);
    expect(place.key).toBe(`${PDF}:page:7`);
    expect(placeKey({ materialId: VIDEO, pageNumber: null, startMs: 1000, endMs: 2000 })).toBe(`${VIDEO}:time:1000-2000`);
    expect(placeKey({ materialId: PDF, pageNumber: null, startMs: null, endMs: null })).toBe(`${PDF}:document`);
  });
});

describe("toPlaceFilters", () => {
  it("builds the place JSON the get_course_questions RPC takes", () => {
    const places = groupChunksIntoPlaces([
      chunk({ page_number: 3 }),
      chunk({ material_id: VIDEO, file_type: "video", page_number: null, start_ms: 1000, end_ms: 5000 }),
    ]);
    expect(toPlaceFilters(places)).toEqual([
      { material_id: PDF, page_number: 3 },
      { material_id: VIDEO, start_ms: 1000, end_ms: 5000 },
    ]);
  });
});

describe("formatPlaceLabel", () => {
  it("names pages, documents and video moments", () => {
    expect(formatPlaceLabel({ pageNumber: 12, startMs: null, endMs: null })).toBe("Page 12");
    expect(formatPlaceLabel({ pageNumber: null, startMs: null, endMs: null })).toBe("Whole document");
    expect(formatPlaceLabel({ pageNumber: null, startMs: 65_000, endMs: 130_000 })).toBe("1:05–2:10");
    expect(formatPlaceLabel({ pageNumber: null, startMs: 3_600_000, endMs: 3_725_000 })).toBe("1:00:00–1:02:05");
  });
});
