import { describe, expect, it, vi } from "vitest";
import type { DecisionResult } from "../_shared/decisions.ts";
import type { MatchedChunk } from "../_shared/analyticsPlaces.ts";
import { KEYWORD_MATCH_COUNT, KEYWORD_MATCH_THRESHOLD } from "../_shared/analyticsPlaces.ts";
import { handleCourseAnalytics, type CourseAnalyticsDeps, type UnlabeledQuestion } from "./handler.ts";

const COURSE = "11111111-1111-4111-8111-111111111111";
const AUTH = "Bearer user-jwt";

const goodDecision: DecisionResult = {
  answers: [
    { type: "choice", name: "category", choice: "calculation", confidence: 0.8, probabilities: [] },
    { type: "predicate", name: "is_study_question", probability: 0.9 },
    { type: "predicate", name: "answered_from_materials", probability: 0.7 },
  ],
  inputTokens: 300,
};

function question(id: string): UnlabeledQuestion {
  return { id, queryText: `question ${id}`, answer: `answer ${id}`, citationCount: 1 };
}

function chunk(overrides: Partial<MatchedChunk> = {}): MatchedChunk {
  return {
    chunk_id: "c1", material_id: "m1", file_name: "Recursion.pdf", file_type: "pdf",
    page_number: 3, start_ms: null, end_ms: null, snippet: "Recursion is…", similarity: 0.6, ...overrides,
  };
}

function deps(overrides: Partial<CourseAnalyticsDeps> = {}): CourseAnalyticsDeps {
  return {
    authorize: vi.fn().mockResolvedValue("admin"),
    embedKeyword: vi.fn().mockResolvedValue([0.1, 0.2]),
    matchChunks: vi.fn().mockResolvedValue([chunk()]),
    findUnlabeledQuestions: vi.fn().mockResolvedValue([]),
    countUnlabeledQuestions: vi.fn().mockResolvedValue(0),
    decide: vi.fn().mockResolvedValue(goodDecision),
    saveLabels: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = { Authorization: AUTH }): Request {
  return new Request("https://example.test/course-analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("course-analytics auth", () => {
  it("answers CORS preflight", async () => {
    const response = await handleCourseAnalytics(new Request("https://example.test", { method: "OPTIONS" }), deps());
    expect(response.status).toBe(200);
  });

  it("requires a token, a valid user and an admin", async () => {
    expect((await handleCourseAnalytics(post({}, {}), deps())).status).toBe(401);
    expect((await handleCourseAnalytics(post({}), deps({ authorize: vi.fn().mockResolvedValue("unauthorized") }))).status).toBe(401);
    const forbidden = deps({ authorize: vi.fn().mockResolvedValue("forbidden") });
    const response = await handleCourseAnalytics(post({ action: "match-keyword", courseId: COURSE, keyword: "x" }), forbidden);
    expect(response.status).toBe(403);
    expect(forbidden.embedKeyword).not.toHaveBeenCalled();
  });

  it("rejects bad bodies and unknown actions", async () => {
    expect((await handleCourseAnalytics(post("not json"), deps())).status).toBe(400);
    expect((await handleCourseAnalytics(post({ action: "nope", courseId: COURSE }), deps())).status).toBe(400);
    expect((await handleCourseAnalytics(post({ action: "match-keyword", courseId: "not-a-uuid", keyword: "x" }), deps())).status).toBe(400);
  });
});

describe("match-keyword", () => {
  it("embeds the keyword, searches the course as the caller and returns places", async () => {
    const d = deps({
      matchChunks: vi.fn().mockResolvedValue([
        chunk({ chunk_id: "a", page_number: 3, similarity: 0.6 }),
        chunk({ chunk_id: "b", page_number: 3, similarity: 0.5 }),
        chunk({ chunk_id: "c", material_id: "v1", file_type: "video", page_number: null, start_ms: 0, end_ms: 30_000, similarity: 0.4 }),
      ]),
    });
    const response = await handleCourseAnalytics(post({ action: "match-keyword", courseId: COURSE, keyword: "  recursion  " }), d);

    expect(response.status).toBe(200);
    expect(d.embedKeyword).toHaveBeenCalledWith("recursion");
    expect(d.matchChunks).toHaveBeenCalledWith(AUTH, [0.1, 0.2], COURSE, KEYWORD_MATCH_THRESHOLD, KEYWORD_MATCH_COUNT);
    const body = await json(response);
    expect(body.keyword).toBe("recursion");
    expect(body.places).toMatchObject([
      { key: "m1:page:3", pageNumber: 3, chunkCount: 2, similarity: 0.6 },
      { key: "v1:time:0-30000", startMs: 0, endMs: 30_000 },
    ]);
  });

  it("needs a keyword of at most 100 characters", async () => {
    expect((await handleCourseAnalytics(post({ action: "match-keyword", courseId: COURSE, keyword: "   " }), deps())).status).toBe(400);
    expect((await handleCourseAnalytics(post({ action: "match-keyword", courseId: COURSE, keyword: "k".repeat(101) }), deps())).status).toBe(400);
  });

  it("reports a search failure as a server error", async () => {
    const d = deps({ matchChunks: vi.fn().mockRejectedValue(new Error("db down")) });
    const response = await handleCourseAnalytics(post({ action: "match-keyword", courseId: COURSE, keyword: "x" }), d);
    expect(response.status).toBe(500);
    expect((await json(response)).error).toBe("db down");
  });
});

describe("label-questions", () => {
  const range = { startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-24T00:00:00.000Z" };

  it("labels each unlabelled question once and reports what is left", async () => {
    const d = deps({
      findUnlabeledQuestions: vi.fn().mockResolvedValue([question("q1"), question("q2")]),
      countUnlabeledQuestions: vi.fn().mockResolvedValue(3),
    });
    const response = await handleCourseAnalytics(post({ action: "label-questions", courseId: COURSE, ...range, limit: 2 }), d);

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ labeled: 2, failed: 0, remaining: 3 });
    expect(d.findUnlabeledQuestions).toHaveBeenCalledWith(COURSE, range, 2);
    expect(d.countUnlabeledQuestions).toHaveBeenCalledWith(COURSE, range);
    expect(d.decide).toHaveBeenCalledTimes(2);
    expect(d.saveLabels).toHaveBeenCalledWith("q1", {
      category: "calculation", categoryConfidence: 0.8, isStudyQuestion: true, answeredFromMaterials: true,
    }, "gpt-6-luna");
  });

  it("saves refused labels as empty so the question isn't sent again", async () => {
    const d = deps({
      findUnlabeledQuestions: vi.fn().mockResolvedValue([question("q1")]),
      decide: vi.fn().mockResolvedValue({ answers: [{ type: "refusal", name: "category" }], inputTokens: null }),
    });
    await handleCourseAnalytics(post({ action: "label-questions", courseId: COURSE }), d);
    expect(d.saveLabels).toHaveBeenCalledWith("q1", {
      category: null, categoryConfidence: null, isStudyQuestion: null, answeredFromMaterials: null,
    }, "gpt-6-luna");
  });

  it("leaves a question unlabelled when the API call fails, and says why", async () => {
    const d = deps({
      findUnlabeledQuestions: vi.fn().mockResolvedValue([question("q1"), question("q2")]),
      decide: vi.fn()
        .mockRejectedValueOnce(new Error("Decisions API error (503): Decision admission timed out"))
        .mockResolvedValueOnce(goodDecision),
      countUnlabeledQuestions: vi.fn().mockResolvedValue(1),
    });
    const response = await handleCourseAnalytics(post({ action: "label-questions", courseId: COURSE }), d);
    expect(await json(response)).toEqual({
      labeled: 1, failed: 1, remaining: 1, error: "Decisions API error (503): Decision admission timed out",
    });
    expect(d.saveLabels).toHaveBeenCalledTimes(1);
  });

  it("caps the batch size and runs a few calls at a time", async () => {
    let running = 0;
    let peak = 0;
    const d = deps({
      findUnlabeledQuestions: vi.fn(async (_course: string, _range: unknown, limit: number) =>
        Array.from({ length: limit }, (_, index) => question(`q${index}`))),
      decide: vi.fn(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return goodDecision;
      }),
    });
    await handleCourseAnalytics(post({ action: "label-questions", courseId: COURSE, limit: 1000 }), d);
    expect(d.findUnlabeledQuestions).toHaveBeenCalledWith(COURSE, { startAt: null, endAt: null }, 50);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("validates the date range", async () => {
    const bad = await handleCourseAnalytics(post({ action: "label-questions", courseId: COURSE, startAt: "yesterday" }), deps());
    expect(bad.status).toBe(400);
    const reversed = await handleCourseAnalytics(post({
      action: "label-questions", courseId: COURSE, startAt: range.endAt, endAt: range.startAt,
    }), deps());
    expect(reversed.status).toBe(400);
  });
});
