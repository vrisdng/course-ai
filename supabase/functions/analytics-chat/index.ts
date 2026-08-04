import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { HttpError, generateChatTextStream } from "../_shared/llm.ts";
import { buildOpenAIConversationMessages, type ConversationHistoryTurn } from "../_shared/history.ts";
import { formatSseEvent, isAbortError, throwIfAborted } from "../_shared/sse.ts";
import { buildAnalyticsSystemPrompt } from "../_shared/analyticsPrompt.ts";

const CHAT_MODEL = "gpt-4o-mini";
const HISTORY_LIMIT = 10;
const DEFAULT_DATA_WINDOW_DAYS = 30;

interface AnalyticsChatRequest {
  message: string;
  courseId: string;
  history?: Array<{ role: string; content: string }>;
  startAt?: string | null;
  endAt?: string | null;
}

function startAtIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function parseIsoDate(value: unknown, fieldName: string): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} must be a valid ISO timestamp`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${fieldName} must be a valid ISO timestamp`);
  }

  return parsed.toISOString();
}

function resolveAnalyticsRange(rawStartAt: unknown, rawEndAt: unknown): { startAt: string; endAt: string; label: string } {
  if (rawStartAt === undefined && rawEndAt === undefined) {
    const endAt = new Date().toISOString();
    const startAt = startAtIso(DEFAULT_DATA_WINDOW_DAYS);
    return { startAt, endAt, label: `last ${DEFAULT_DATA_WINDOW_DAYS} days` };
  }

  const startAt = parseIsoDate(rawStartAt, "startAt");
  const endAt = parseIsoDate(rawEndAt, "endAt");

  if (!startAt || !endAt) {
    throw new HttpError(400, "startAt and endAt are both required");
  }

  if (new Date(startAt).getTime() > new Date(endAt).getTime()) {
    throw new HttpError(400, "startAt must be earlier than or equal to endAt");
  }

  return { startAt, endAt, label: `${startAt} to ${endAt}` };
}

// ── Data fetching ──────────────────────────────────────────────────────

interface AnalyticsData {
  courseName: string;
  courseCode: string | null;
  enrollmentCount: number;
  activeStudentCount: number;
  topQuestions: Array<{ question: string; frequency: number; unique_student_count: number; last_asked_at: string | null }>;
  keywords: Array<{ keyword: string; frequency: number }>;
  documentStats: Array<{ file_name: string; file_type: string; unique_student_count: number; reference_count: number; last_referenced_at: string | null }>;
  unresolvedQueries: Array<{ query_text: string; unresolved_reason: string | null; created_at: string }>;
}

async function fetchAnalyticsData(
  supabaseClient: ReturnType<typeof createClient>,
  supabaseAdmin: ReturnType<typeof createClient>,
  courseId: string,
  startAt: string | null,
  endAt: string | null,
): Promise<AnalyticsData> {
  let unresolvedQuery = supabaseAdmin.from("query_events")
    .select("query_text, unresolved_reason, created_at")
    .eq("course_id", courseId)
    .eq("unresolved", true)
    .order("created_at", { ascending: false })
    .limit(15);

  if (startAt) {
    unresolvedQuery = unresolvedQuery.gte("created_at", startAt);
  }
  if (endAt) {
    unresolvedQuery = unresolvedQuery.lte("created_at", endAt);
  }

  const [
    courseRes,
    enrollmentRes,
    activeStudentRes,
    topQuestionsRes,
    keywordRes,
    documentRes,
    unresolvedRes,
  ] = await Promise.all([
    supabaseAdmin.from("courses").select("name, code").eq("id", courseId).single(),
    supabaseAdmin.from("enrollments").select("id", { count: "exact", head: true }).eq("course_id", courseId),
    supabaseAdmin.rpc("get_course_active_student_count" as string, { in_course_id: courseId, in_start_at: startAt, in_end_at: endAt }),
    supabaseClient.rpc("get_course_top_questions", { in_course_id: courseId, in_start_at: startAt, in_end_at: endAt, in_limit: 10 }),
    supabaseClient.rpc("get_course_keyword_stats", { in_course_id: courseId, in_start_at: startAt, in_end_at: endAt, in_limit: 15 }),
    supabaseClient.rpc("get_course_document_reference_stats", { in_course_id: courseId, in_start_at: startAt, in_end_at: endAt }),
    unresolvedQuery,
  ]);

  return {
    courseName: courseRes.data?.name || "Unknown",
    courseCode: courseRes.data?.code || null,
    enrollmentCount: enrollmentRes.count ?? 0,
    activeStudentCount: typeof activeStudentRes.data === "number" ? activeStudentRes.data : 0,
    topQuestions: Array.isArray(topQuestionsRes.data) ? topQuestionsRes.data : [],
    keywords: Array.isArray(keywordRes.data) ? keywordRes.data : [],
    documentStats: Array.isArray(documentRes.data) ? documentRes.data : [],
    unresolvedQueries: Array.isArray(unresolvedRes.data) ? unresolvedRes.data : [],
  };
}

function formatAnalyticsContext(data: AnalyticsData, rangeLabel: string): string {
  const lines: string[] = [];
  lines.push(`=== COURSE ANALYTICS DATA (${rangeLabel}) ===`);
  lines.push(`Course: ${data.courseName}${data.courseCode ? ` (${data.courseCode})` : ""}`);
  lines.push("");

  lines.push(`## Enrollment & Activity`);
  lines.push(`Total enrolled students: ${data.enrollmentCount}`);
  lines.push(`Active students (asked at least one question): ${data.activeStudentCount}`);
  lines.push("");

  if (data.topQuestions.length > 0) {
    lines.push(`## Top Questions`);
    data.topQuestions.forEach((q, i) => {
      lines.push(`${i + 1}. "${q.question}" — asked ${q.frequency} time(s) by ${q.unique_student_count} student(s)`);
    });
    lines.push("");
  }

  if (data.keywords.length > 0) {
    lines.push(`## Frequent Keywords / Topics`);
    lines.push(data.keywords.map((k) => `${k.keyword} (${k.frequency})`).join(", "));
    lines.push("");
  }

  if (data.documentStats.length > 0) {
    lines.push(`## Document Usage`);
    data.documentStats.forEach((d, i) => {
      lines.push(`${i + 1}. ${d.file_name} [${d.file_type}] — referenced ${d.reference_count} time(s) by ${d.unique_student_count} student(s)`);
    });
    lines.push("");
  }

  if (data.unresolvedQueries.length > 0) {
    lines.push(`## Unresolved Questions`);
    data.unresolvedQueries.forEach((u, i) => {
      lines.push(`${i + 1}. "${u.query_text}" — reason: ${u.unresolved_reason || "unknown"}`);
    });
    lines.push("");
  }

  if (data.topQuestions.length === 0 && data.keywords.length === 0 && data.documentStats.length === 0) {
    lines.push("No student activity data found for this time period.");
  }

  return lines.join("\n");
}

// ── Main handler ──────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestAbortController = new AbortController();
  const abortRequestWork = (reason?: unknown) => {
    if (!requestAbortController.signal.aborted) {
      requestAbortController.abort(reason);
    }
  };

  req.signal.addEventListener(
    "abort",
    () => {
      console.log("Analytics chat request aborted by client");
      abortRequestWork("client disconnected");
    },
    { once: true },
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openAiApiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: isAdmin } = await supabaseClient.rpc("is_admin", { check_user_id: user.id });
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { message, courseId, history, startAt: rawStartAt, endAt: rawEndAt } = (await req.json()) as AnalyticsChatRequest;
    const trimmedMessage = message?.trim();

    if (!trimmedMessage) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!courseId) {
      return new Response(
        JSON.stringify({ error: "courseId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throwIfAborted(requestAbortController.signal);

    // Fetch analytics data
    const range = resolveAnalyticsRange(rawStartAt, rawEndAt);
    const analyticsData = await fetchAnalyticsData(supabaseClient, supabaseAdmin, courseId, range.startAt, range.endAt);
    const analyticsContext = formatAnalyticsContext(analyticsData, range.label);

    throwIfAborted(requestAbortController.signal);

    // Build conversation history (ephemeral, from client)
    const historyTurns: ConversationHistoryTurn[] = (Array.isArray(history) ? history : [])
      .slice(-HISTORY_LIMIT)
      .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
      .map((t) => ({ role: t.role as "user" | "assistant", content: t.content.slice(0, 800) }));

    const systemPrompt = buildAnalyticsSystemPrompt(analyticsContext);

    // Stream response
    let streamCancelled = false;
    const cancelStream = (reason?: unknown) => {
      if (streamCancelled) return;
      streamCancelled = true;
      abortRequestWork(reason);
    };

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (event: string, payload: unknown) => {
          if (streamCancelled) return;
          controller.enqueue(encoder.encode(formatSseEvent(event, payload)));
        };

        (async () => {
          try {
            throwIfAborted(requestAbortController.signal);

            const answer = await generateChatTextStream({
              apiKey: openAiApiKey,
              model: CHAT_MODEL,
              messages: buildOpenAIConversationMessages(systemPrompt, trimmedMessage, historyTurns),
              temperature: 0.3,
              maxOutputTokens: 2000,
              signal: requestAbortController.signal,
              onTextDelta: (delta) => {
                if (streamCancelled) return;
                sendEvent("token", { text: delta });
              },
            });

            if (!streamCancelled) {
              sendEvent("final", { answer });
            }
          } catch (streamError) {
            if (isAbortError(streamError)) {
              console.log("Analytics chat stream aborted");
              return;
            }

            console.error("Analytics chat stream error:", streamError);
            const status = streamError instanceof HttpError ? streamError.status : 500;
            const errorMessage = streamError instanceof Error ? streamError.message : "An unexpected error occurred";
            sendEvent("error", { error: errorMessage, status });
          } finally {
            if (!streamCancelled) {
              controller.close();
            }
          }
        })();
      },
      cancel(reason) {
        cancelStream(reason);
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Analytics chat error:", error);
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
