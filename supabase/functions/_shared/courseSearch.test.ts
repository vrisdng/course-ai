import { describe, expect, it, vi } from "vitest";

import {
  MAX_SOURCES_PER_ANSWER,
  SourceRegistry,
  formatSourceBody,
  runCourseSearch,
  sourceLimitForSearches,
  type CourseSearchDeps,
  type NumberedSource,
  type SearchableChunk,
} from "./courseSearch.ts";

function chunk(id: string, overrides: Partial<SearchableChunk> = {}): SearchableChunk {
  return {
    id,
    chunk_text: `text of ${id}`,
    material_id: `m-${id}`,
    student_document_id: null,
    page_number: 3,
    start_ms: null,
    end_ms: null,
    relevance_score: 0.5,
    material_name: "Lecture 4",
    material_type: "pdf",
    ...overrides,
  };
}

describe("SourceRegistry", () => {
  it("numbers sources in the order they are first found", () => {
    const registry = new SourceRegistry();
    const added = registry.add([chunk("a"), chunk("b")]);
    expect(added.map((s) => [s.number, s.chunk.id, s.isNew])).toEqual([
      [1, "a", true],
      [2, "b", true],
    ]);
    expect(registry.list().map((c) => c.id)).toEqual(["a", "b"]);
    expect(registry.size).toBe(2);
  });

  it("keeps a chunk's first number when a later search finds it again", () => {
    const registry = new SourceRegistry();
    registry.add([chunk("a"), chunk("b")]);
    const again = registry.add([chunk("c"), chunk("a")]);
    expect(again.map((s) => [s.number, s.chunk.id, s.isNew])).toEqual([
      [3, "c", true],
      [1, "a", false],
    ]);
    expect(registry.list().map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves out new chunks past the limit but still returns known ones", () => {
    const registry = new SourceRegistry(2);
    registry.add([chunk("a"), chunk("b")]);
    const added = registry.add([chunk("c"), chunk("b")]);
    expect(added.map((s) => s.chunk.id)).toEqual(["b"]);
    expect(registry.size).toBe(2);
  });

  it("caps an answer at MAX_SOURCES_PER_ANSWER by default", () => {
    const registry = new SourceRegistry();
    registry.add(Array.from({ length: MAX_SOURCES_PER_ANSWER + 5 }, (_, i) => chunk(`c${i}`)));
    expect(registry.size).toBe(MAX_SOURCES_PER_ANSWER);
  });
});

describe("formatSourceBody", () => {
  it("labels a source's blocks so parts can be cited, within the character budget", () => {
    const body = formatSourceBody({ number: 2, chunkText: "unused", blockTexts: ["Heading", "Body text", "x".repeat(50)], maxChars: 30 });
    expect(body.text).toBe("[2a] Heading\n[2b] Body text");
    expect(body.shownBlockCount).toBe(2);
  });

  it("shows clipped chunk text when the source has no blocks", () => {
    const body = formatSourceBody({ number: 1, chunkText: "y".repeat(20), maxChars: 10 });
    expect(body.text).toBe(`${"y".repeat(10)}...`);
    expect(body.shownBlockCount).toBe(0);
  });

  it("adds the image reference token for image sources", () => {
    const body = formatSourceBody({ number: 4, chunkText: "A diagram", maxChars: 100, hasImage: true });
    expect(body.text).toBe("A diagram\nImage reference token: img-source-4");
  });
});

describe("runCourseSearch", () => {
  function deps(found: SearchableChunk[], registry = new SourceRegistry()) {
    return {
      search: vi.fn(async () => found),
      registry,
      prepare: vi.fn(async () => {}),
      renderBody: vi.fn((source: NumberedSource) => `body of ${source.chunk.id}`),
    } satisfies CourseSearchDeps<SearchableChunk>;
  }

  it("asks for a query when the model sends an empty one", async () => {
    const d = deps([chunk("a")]);
    expect(await runCourseSearch("   ", d)).toMatch(/Empty search query/);
    expect(d.search).not.toHaveBeenCalled();
  });

  it("tells the model when nothing matched", async () => {
    const d = deps([]);
    expect(await runCourseSearch(" tombstones ", d)).toBe(
      'No course material matched "tombstones". Try different wording, or tell the student the materials don\'t cover it.',
    );
    expect(d.search).toHaveBeenCalledWith("tombstones");
    expect(d.prepare).not.toHaveBeenCalled();
  });

  it("returns each result as a numbered source with its label, type and body", async () => {
    const d = deps([chunk("a"), chunk("b", { material_name: "Talk", material_type: "video", page_number: null, start_ms: 65_000, end_ms: 125_000 })]);

    const text = await runCourseSearch("hashing", d);

    expect(text).toBe(
      "Source [1]: Lecture 4 (Page 3) [pdf]\nbody of a\n\nSource [2]: Talk (1:05-2:05) [video]\nbody of b",
    );
  });

  it("prepares only sources it has not shown before", async () => {
    const registry = new SourceRegistry();
    registry.add([chunk("a")]);
    const d = deps([chunk("a"), chunk("b")], registry);

    await runCourseSearch("hashing", d);

    expect(d.prepare).toHaveBeenCalledTimes(1);
    const prepared = (d.prepare.mock.calls[0] as unknown as [NumberedSource[]])[0];
    expect(prepared.map((s) => [s.number, s.chunk.id])).toEqual([[2, "b"]]);
    expect(d.renderBody).toHaveBeenCalledTimes(2);
  });

  it("says the source limit is full instead of reporting no match", async () => {
    const registry = new SourceRegistry(1);
    registry.add([chunk("a")]);
    const d = deps([chunk("b"), chunk("c")], registry);

    const text = await runCourseSearch("hashing", d);

    expect(text).toMatch(/already holds the most sources it can/);
    expect(text).not.toMatch(/No course material matched/);
    expect(d.prepare).not.toHaveBeenCalled();
  });

  it("notes how many matches were left out when the limit fills mid-search", async () => {
    const registry = new SourceRegistry(2);
    registry.add([chunk("a")]);
    const d = deps([chunk("b"), chunk("c"), chunk("d")], registry);

    const text = await runCourseSearch("hashing", d);

    expect(text).toMatch(/^Source \[2\]: /);
    expect(text).toMatch(/2 more matches were left out/);
  });
});

describe("sourceLimitForSearches", () => {
  it("leaves room for every search to return a full set of new sources", () => {
    expect(sourceLimitForSearches(4, 10)).toBe(40);
  });

  it("never goes below one source", () => {
    expect(sourceLimitForSearches(0, 10)).toBe(1);
  });
});
