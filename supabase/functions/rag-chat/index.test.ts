// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
  events: [] as Array<Record<string, unknown>>,
  persistenceFails: false,
  otherOwner: false,
  generationFails: false,
  noRagPrompt: "",
  abort: null as null | AbortController,
}));

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (handler: typeof state.handler) => { state.handler = handler; },
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2.49.1", () => ({
  createClient: () => ({
    rpc: async () => ({ data: [], error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) },
    from: (table: string) => {
      let inserted: Record<string, unknown> | null = null;
      const result = () => {
        if (table === "query_events") {
          state.events.push(inserted!);
          return { data: null, error: null };
        }
        if (table === "conversations") return { data: { id: "conversation", course_id: "course", user_id: state.otherOwner ? "other" : "user" }, error: null };
        if (table === "messages" && inserted) return state.persistenceFails
          ? { data: null, error: { message: "save failed" } }
          : { data: { id: `${inserted.role}-message` }, error: null };
        if (table === "messages") return { data: [], error: null };
        return { data: null, error: null };
      };
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
        update: () => builder,
        insert: (payload: Record<string, unknown>) => { inserted = payload; return builder; },
        single: async () => result(), maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  }),
}));
vi.mock("../_shared/llm.ts", () => ({
  HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  createOpenAIEmbeddingService: () => ({ model: "embedding", embedQuery: async () => [1] }),
  generateAgentTextStream: async (options: {
    tool: { execute: (query: string) => Promise<string> };
    onToolCall: (query: string) => void;
    onTextDelta: (text: string) => void;
    onUsage: (usage: { promptTokens: number; completionTokens: number }) => void;
  }) => {
    if (state.generationFails) throw new Error("private provider failure");
    options.onToolCall("query");
    await options.tool.execute("query");
    options.onTextDelta("answer");
    options.onUsage({ promptTokens: 20, completionTokens: 4 });
    return { text: "answer", usage: { promptTokens: 20, completionTokens: 4 } };
  },
  generateChatText: vi.fn(),
  generateChatTextStream: async (options: { messages: Array<{ role: string; content: string }>; onTextDelta: (text: string) => void; onUsage: (usage: { promptTokens: number; completionTokens: number }) => void }) => {
    state.noRagPrompt = options.messages[0].content;
    if (state.abort) {
      state.abort.abort();
      throw new Error("Chat API error: wrapped cancellation");
    }
    options.onTextDelta("answer");
    options.onUsage({ promptTokens: 10, completionTokens: 2 });
    return { text: "answer", usage: { promptTokens: 10, completionTokens: 2 } };
  },
}));

describe("RAG terminal telemetry wiring", () => {
  beforeEach(async () => {
    state.events = [];
    state.persistenceFails = false;
    state.otherOwner = false;
    state.generationFails = false;
    state.abort = null;
    vi.stubGlobal("Deno", { env: { get: () => "test" } });
    await import("./index");
  });

  async function run(skipRag = true) {
    const response = await state.handler!(new Request("http://localhost/rag-chat", {
      method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", conversationId: "conversation", courseId: "course", skipRag }),
      signal: state.abort?.signal,
    }));
    return { response, body: await response.text() };
  }

  it("offers a selection step when an ungrounded request refers to selected materials", async () => {
    await run();
    expect(state.noRagPrompt).toContain("select materials in the material selector");
  });

  it("records one successful request with resolved IDs and model usage", async () => {
    const { body } = await run();
    expect(body).toContain("event: final");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      outcome: "success", error_code: null, course_id: "course", conversation_id: "conversation",
      user_message_id: "user-message", assistant_message_id: "assistant-message",
      prompt_tokens: 10, completion_tokens: 2, skip_rag: true, search_count: 0,
    });
  });

  it("records real searches separately from tool calls in the agent path", async () => {
    const { body } = await run(false);
    expect(body).toContain("event: final");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      outcome: "success", search_count: 1, tool_call_count: 1, skip_rag: false,
      prompt_tokens: 20, completion_tokens: 4,
    });
    expect(state.events[0].embedding_ms).toEqual(expect.any(Number));
    expect(state.events[0].retrieval_ms).toEqual(expect.any(Number));
  });

  it("records stream failures without storing the provider's message as an error code", async () => {
    state.generationFails = true;
    const { body } = await run(false);
    expect(body).toContain("event: error");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ outcome: "error", error_code: "Error", assistant_message_id: null });
  });

  it("records delivery even when message persistence returns an error", async () => {
    state.persistenceFails = true;
    const { body } = await run();
    expect(body).toContain("event: final");
    expect(body).not.toContain("event: error");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      outcome: "success", error_code: "message_persistence_failed",
      user_message_id: null, assistant_message_id: null,
    });
  });

  it("records a wrapped client abort without sending a stream error", async () => {
    state.abort = new AbortController();
    const { body } = await run();
    expect(body).not.toContain("event: error");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ outcome: "aborted", error_code: "client_aborted", prompt_tokens: null });
  });

  it("does not attribute an access failure to client-supplied IDs", async () => {
    state.otherOwner = true;
    const { response } = await run();
    expect(response.status).toBe(403);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ outcome: "error", error_code: "http_403", course_id: null, conversation_id: null });
  });
});
