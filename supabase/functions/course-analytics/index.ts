// Admin course analytics: keyword → matched places, and Decisions API
// labelling of student questions. Request handling and the admin check are
// in handler.ts; this file wires the real clients.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { createOpenAIDecisionsClient, createOpenAIEmbeddingService } from "../_shared/llm.ts";
import type { MatchedChunk } from "../_shared/analyticsPlaces.ts";
import { handleCourseAnalytics, type AnalyticsRange, type UnlabeledQuestion } from "./handler.ts";

interface UnlabeledEventRow {
  id: string;
  query_text: string;
  citation_count: number | null;
  assistant_message_id: string | null;
}

serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !serviceKey || !openAiApiKey) {
    return new Response(JSON.stringify({ error: "course-analytics is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  // Runs RPCs as the caller, so auth.uid() inside them is the admin.
  const asCaller = (authHeader: string) =>
    createClient(supabaseUrl, serviceKey, { global: { headers: { Authorization: authHeader } } });
  const embeddings = createOpenAIEmbeddingService(openAiApiKey);

  const unlabeledQuery = (courseId: string, range: AnalyticsRange, columns: string, head = false) => {
    let query = admin
      .from("query_events")
      .select(columns, head ? { count: "exact", head: true } : undefined)
      .eq("course_id", courseId)
      .eq("outcome", "success")
      .is("error_code", null)
      .is("ai_labeled_at", null);
    if (range.startAt) query = query.gte("created_at", range.startAt);
    if (range.endAt) query = query.lte("created_at", range.endAt);
    return query;
  };

  return handleCourseAnalytics(req, {
    async authorize(authHeader) {
      const client = asCaller(authHeader);
      const { data: { user }, error } = await client.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !user) return "unauthorized";
      const { data: isAdmin } = await client.rpc("is_admin", { check_user_id: user.id });
      return isAdmin === true ? "admin" : "forbidden";
    },

    embedKeyword: (keyword) => embeddings.embedQuery(keyword),

    async matchChunks(authHeader, embedding, courseId, threshold, count) {
      const { data, error } = await asCaller(authHeader).rpc("match_course_chunks_for_analytics", {
        query_embedding: embedding,
        in_course_id: courseId,
        match_threshold: threshold,
        match_count: count,
      });
      if (error) throw new Error(`Keyword search failed: ${error.message}`);
      return (data ?? []) as MatchedChunk[];
    },

    async findUnlabeledQuestions(courseId, range, limit) {
      const { data, error } = await unlabeledQuery(courseId, range, "id, query_text, citation_count, assistant_message_id")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Could not load questions to label: ${error.message}`);
      const rows = (data ?? []) as unknown as UnlabeledEventRow[];

      const messageIds = rows.map((row) => row.assistant_message_id).filter((id): id is string => Boolean(id));
      const answers = new Map<string, string>();
      if (messageIds.length > 0) {
        const { data: messages, error: messagesError } = await admin
          .from("messages")
          .select("id, content")
          .in("id", messageIds);
        if (messagesError) throw new Error(`Could not load answers to label: ${messagesError.message}`);
        for (const message of (messages ?? []) as Array<{ id: string; content: string }>) {
          answers.set(message.id, message.content);
        }
      }

      return rows.map((row): UnlabeledQuestion => ({
        id: row.id,
        queryText: row.query_text,
        answer: row.assistant_message_id ? answers.get(row.assistant_message_id) ?? null : null,
        citationCount: row.citation_count ?? 0,
      }));
    },

    async countUnlabeledQuestions(courseId, range) {
      const { count, error } = await unlabeledQuery(courseId, range, "id", true);
      if (error) throw new Error(`Could not count questions to label: ${error.message}`);
      return count ?? 0;
    },

    decide: createOpenAIDecisionsClient(openAiApiKey),

    async saveLabels(questionId, labels, model) {
      const { error } = await admin
        .from("query_events")
        .update({
          ai_category: labels.category,
          ai_category_confidence: labels.categoryConfidence,
          ai_is_study_question: labels.isStudyQuestion,
          ai_answered_from_materials: labels.answeredFromMaterials,
          ai_labeled_at: new Date().toISOString(),
          ai_label_model: model,
        })
        .eq("id", questionId)
        .is("ai_labeled_at", null);
      if (error) throw new Error(`Could not save labels: ${error.message}`);
    },
  });
});
