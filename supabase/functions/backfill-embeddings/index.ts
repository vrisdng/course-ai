// Fills chunks.embedding_openai for chunks that do not have one yet, using the
// shared embedding service. Idempotent and resumable: each call embeds up to
// `limit` chunks; call again until `remaining` is 0. Secret-key only — this is
// an operator tool, not something the app calls.
import { withSupabase } from "npm:@supabase/server";
import { EMBEDDING_COLUMN } from "../_shared/embeddings.ts";
import { createOpenAIEmbeddingService } from "../_shared/llm.ts";

interface BackfillRequest {
  limit?: number;
}

interface BackfillResponse {
  model: string;
  embedded: number;
  remaining: number;
}

interface ChunkToEmbed {
  id: string;
  chunk_text: string;
}

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;
const UPDATE_CONCURRENCY = 10;

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiApiKey) {
      return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as BackfillRequest;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(body.limit ?? DEFAULT_LIMIT)));

    const { data: chunks, error: selectError } = await ctx.supabaseAdmin
      .from("chunks")
      .select("id, chunk_text")
      .is(EMBEDDING_COLUMN, null)
      .order("id")
      .limit(limit);
    if (selectError) {
      return Response.json({ error: `Failed to load chunks: ${selectError.message}` }, { status: 500 });
    }

    const pending = (chunks ?? []) as ChunkToEmbed[];
    const embeddingService = createOpenAIEmbeddingService(openAiApiKey);
    const vectors = await embeddingService.embedDocuments(pending.map((chunk) => chunk.chunk_text));

    for (let start = 0; start < pending.length; start += UPDATE_CONCURRENCY) {
      const updates = pending.slice(start, start + UPDATE_CONCURRENCY).map((chunk, offset) =>
        ctx.supabaseAdmin
          .from("chunks")
          .update({ [EMBEDDING_COLUMN]: vectors[start + offset] })
          .eq("id", chunk.id)
      );
      const failed = (await Promise.all(updates)).find((result) => result.error);
      if (failed?.error) {
        return Response.json({ error: `Failed to store embeddings: ${failed.error.message}` }, { status: 500 });
      }
    }

    const { count, error: countError } = await ctx.supabaseAdmin
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .is(EMBEDDING_COLUMN, null);
    if (countError) {
      return Response.json({ error: `Failed to count remaining chunks: ${countError.message}` }, { status: 500 });
    }

    const response: BackfillResponse = {
      model: embeddingService.model,
      embedded: pending.length,
      remaining: count ?? 0,
    };
    return Response.json(response);
  }),
};
