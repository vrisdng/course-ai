// Request handling for course-analytics, with its database, embedding and
// Decisions API calls passed in so it can be tested without Deno. index.ts
// wires the real clients. Admins only.
//
// Actions:
//   match-keyword    Embed a teacher's topic, search the course's chunks and
//                    return the places (pages, video stretches) it matched.
//                    The page then lists questions whose answers cited them
//                    through the get_course_questions RPC.
//   label-questions  Label up to `limit` not-yet-labelled questions in the
//                    window with the Decisions API (questionLabels.ts). The
//                    admin page calls this when it opens, so each question is
//                    labelled once, shortly after anyone looks.
import { corsHeaders } from "../_shared/cors.ts";
import {
  KEYWORD_MATCH_COUNT,
  KEYWORD_MATCH_THRESHOLD,
  groupChunksIntoPlaces,
  type AnalyticsPlace,
  type MatchedChunk,
} from "../_shared/analyticsPlaces.ts";
import { DECISIONS_MODEL, type DecideFn } from "../_shared/decisions.ts";
import { buildQuestionLabelRequest, parseQuestionLabels, type QuestionLabels } from "../_shared/questionLabels.ts";

export type AuthorizationResult = "admin" | "unauthorized" | "forbidden";

export interface AnalyticsRange {
  startAt: string | null;
  endAt: string | null;
}

export interface UnlabeledQuestion {
  id: string;
  queryText: string;
  answer: string | null;
  citationCount: number;
}

export interface CourseAnalyticsDeps {
  authorize(authHeader: string): Promise<AuthorizationResult>;
  embedKeyword(keyword: string): Promise<number[]>;
  // Runs as the caller, so the RPC's own admin check applies too.
  matchChunks(
    authHeader: string,
    embedding: number[],
    courseId: string,
    threshold: number,
    count: number,
  ): Promise<MatchedChunk[]>;
  findUnlabeledQuestions(courseId: string, range: AnalyticsRange, limit: number): Promise<UnlabeledQuestion[]>;
  countUnlabeledQuestions(courseId: string, range: AnalyticsRange): Promise<number>;
  decide: DecideFn;
  saveLabels(questionId: string, labels: QuestionLabels, model: string): Promise<void>;
}

interface MatchKeywordRequest {
  action: "match-keyword";
  courseId: string;
  keyword: string;
}

interface LabelQuestionsRequest {
  action: "label-questions";
  courseId: string;
  startAt?: string | null;
  endAt?: string | null;
  limit?: number;
}

export interface MatchKeywordResponse {
  keyword: string;
  places: AnalyticsPlace[];
}

export interface LabelQuestionsResponse {
  labeled: number;
  failed: number;
  remaining: number;
  // The last labelling error, when any call failed.
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_KEYWORD_CHARS = 100;
const DEFAULT_LABEL_BATCH = 25;
const MAX_LABEL_BATCH = 50;
const LABEL_CONCURRENCY = 4;

class BadRequest extends Error {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === "string" && value.trim() ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new BadRequest(`${field} must be an ISO timestamp`);
  return parsed.toISOString();
}

function parseRange(body: LabelQuestionsRequest): AnalyticsRange {
  const range = { startAt: parseTimestamp(body.startAt, "startAt"), endAt: parseTimestamp(body.endAt, "endAt") };
  if (range.startAt && range.endAt && range.startAt > range.endAt) {
    throw new BadRequest("startAt must be earlier than or equal to endAt");
  }
  return range;
}

function batchSize(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LABEL_BATCH;
  return Math.min(MAX_LABEL_BATCH, Math.max(1, Math.floor(limit)));
}

async function matchKeyword(body: MatchKeywordRequest, authHeader: string, deps: CourseAnalyticsDeps): Promise<Response> {
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword) throw new BadRequest("keyword is required");
  if (keyword.length > MAX_KEYWORD_CHARS) throw new BadRequest(`keyword must be at most ${MAX_KEYWORD_CHARS} characters`);

  const embedding = await deps.embedKeyword(keyword);
  const chunks = await deps.matchChunks(authHeader, embedding, body.courseId, KEYWORD_MATCH_THRESHOLD, KEYWORD_MATCH_COUNT);
  const response: MatchKeywordResponse = { keyword, places: groupChunksIntoPlaces(chunks) };
  return json(response);
}

// Runs `work` over `items`, at most `limit` at a time.
async function forEachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(lanes);
}

async function labelQuestions(body: LabelQuestionsRequest, deps: CourseAnalyticsDeps): Promise<Response> {
  const range = parseRange(body);
  const questions = await deps.findUnlabeledQuestions(body.courseId, range, batchSize(body.limit));

  let labeled = 0;
  let failed = 0;
  let lastError: string | undefined;
  await forEachLimited(questions, LABEL_CONCURRENCY, async (question) => {
    try {
      const result = await deps.decide(buildQuestionLabelRequest({
        question: question.queryText,
        answer: question.answer,
        citationCount: question.citationCount,
      }));
      await deps.saveLabels(question.id, parseQuestionLabels(result.answers), DECISIONS_MODEL);
      labeled += 1;
    } catch (error) {
      // Not saved, so it's tried again next time.
      failed += 1;
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`Labelling question ${question.id} failed:`, lastError);
    }
  });

  const response: LabelQuestionsResponse = {
    labeled,
    failed,
    remaining: await deps.countUnlabeledQuestions(body.courseId, range),
    ...(lastError ? { error: lastError } : {}),
  };
  return json(response);
}

export async function handleCourseAnalytics(req: Request, deps: CourseAnalyticsDeps): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);
    const authorization = await deps.authorize(authHeader);
    if (authorization === "unauthorized") return json({ error: "Unauthorized" }, 401);
    if (authorization === "forbidden") return json({ error: "Forbidden" }, 403);

    let body: MatchKeywordRequest | LabelQuestionsRequest;
    try {
      body = await req.json();
    } catch {
      throw new BadRequest("Request body must be JSON");
    }
    if (!body || typeof body !== "object" || typeof body.courseId !== "string" || !UUID.test(body.courseId)) {
      throw new BadRequest("courseId must be a UUID");
    }

    if (body.action === "match-keyword") return await matchKeyword(body, authHeader, deps);
    if (body.action === "label-questions") return await labelQuestions(body, deps);
    throw new BadRequest("Unknown action");
  } catch (error) {
    if (error instanceof BadRequest) return json({ error: error.message }, 400);
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("course-analytics error:", message);
    return json({ error: message }, 500);
  }
}
