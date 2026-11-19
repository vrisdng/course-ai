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
  labelUpdates: [] as Array<Record<string, unknown>>,
  background: [] as Array<Promise<unknown>>,
  decide: null as null | ReturnType<typeof vi.fn>,
  history: [] as Array<Record<string, unknown>>,
  historyAttachments: [] as Array<Record<string, unknown>>,
  attachmentInserts: [] as unknown[],
  downloads: [] as string[],
  modelMessages: [] as Array<{ role: string; content: unknown }>,
}));

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (handler: typeof state.handler) => { state.handler = handler; },
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2.49.1", () => ({
  createClient: () => ({
    rpc: async () => ({ data: [], error: null }),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          state.downloads.push(`${bucket}:${path}`);
          return { data: new Blob([new Uint8Array([104, 105])]), error: null };
        },
      }),
    },
    auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) },
    from: (table: string) => {
      let inserted: Record<string, unknown> | null = null;
      let updated: Record<string, unknown> | null = null;
      const result = () => {
        if (table === "query_events" && updated) {
          state.labelUpdates.push(updated);
          return { data: null, error: null };
        }
        if (table === "query_events") {
          state.events.push(inserted!);
          return { data: { id: "event-1" }, error: null };
        }
        if (table === "conversations") return { data: { id: "conversation", course_id: "course", user_id: state.otherOwner ? "other" : "user" }, error: null };
        if (table === "messages" && inserted) return state.persistenceFails
          ? { data: null, error: { message: "save failed" } }
          : { data: { id: `${inserted.role}-message` }, error: null };
        if (table === "messages") return { data: state.history, error: null };
        if (table === "message_attachments" && inserted) {
          state.attachmentInserts.push(inserted);
          return { data: null, error: null };
        }
        if (table === "message_attachments") return { data: state.historyAttachments, error: null };
        return { data: null, error: null };
      };
      const builder = {
        select: () => builder, eq: () => builder, is: () => builder, in: () => builder, order: () => builder, limit: () => builder,
        update: (payload: Record<string, unknown>) => { updated = payload; return builder; },
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
  createOpenAIDecisionsClient: () => (request: unknown) => state.decide!(request),
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
    state.modelMessages = options.messages;
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
    state.labelUpdates = [];
    state.background = [];
    state.history = [];
    state.historyAttachments = [];
    state.attachmentInserts = [];
    state.downloads = [];
    state.modelMessages = [];
    state.decide = vi.fn().mockResolvedValue({
      answers: [
        { type: "choice", name: "category", choice: "calculation", confidence: 0.8, probabilities: [] },
        { type: "predicate", name: "is_study_question", probability: 0.9 },
        { type: "predicate", name: "answered_from_materials", probability: 0.7 },
      ],
      inputTokens: 100,
    });
    vi.stubGlobal("Deno", { env: { get: () => "test" } });
    vi.stubGlobal("EdgeRuntime", { waitUntil: (work: Promise<unknown>) => { state.background.push(work); } });
    await import("./index");
  });

  async function run(skipRag = true, extra: Record<string, unknown> = {}) {
    const response = await state.handler!(new Request("http://localhost/rag-chat", {
      method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", conversationId: "conversation", courseId: "course", skipRag, ...extra }),
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

  it("labels a delivered, saved question in the background", async () => {
    const { body } = await run();
    expect(body).toContain("event: final");
    expect(state.background).toHaveLength(1);
    await Promise.all(state.background);

    expect(state.decide).toHaveBeenCalledTimes(1);
    const turn = state.decide!.mock.calls[0][0].input[1].content[0].text as string;
    expect(turn).toContain("hello");
    expect(turn).toContain("answer");
    expect(state.labelUpdates).toEqual([expect.objectContaining({
      ai_category: "calculation", ai_is_study_question: true, ai_answered_from_materials: true,
      ai_labeled_at: expect.any(String),
    })]);
  });

  it("does not label a turn that failed or was not saved", async () => {
    state.generationFails = true;
    await run(false);
    state.generationFails = false;
    state.persistenceFails = true;
    await run();

    expect(state.background).toHaveLength(0);
    expect(state.decide).not.toHaveBeenCalled();
    expect(state.labelUpdates).toHaveLength(0);
  });

  it("keeps the chat unaffected when labelling fails", async () => {
    state.decide!.mockRejectedValue(new Error("Decision admission timed out"));
    const { body } = await run();
    expect(body).toContain("event: final");
    expect(body).not.toContain("event: error");
    await expect(Promise.all(state.background)).resolves.toBeDefined();
    expect(state.labelUpdates).toHaveLength(0);
    expect(state.events).toHaveLength(1);
  });

  describe("question images", () => {
    const IMAGE = "user/0b6c1d2e-0000-4000-8000-000000000001.png";
    const IMAGE_PART = { type: "image", image: "aGk=", mimeType: "image/png" };

    it("sends attached images to the model and links them to the saved question", async () => {
      const { body } = await run(true, { imagePaths: [IMAGE] });
      expect(body).toContain("event: final");
      expect(state.downloads).toEqual([`question-images:${IMAGE}`]);
      expect(state.modelMessages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "hello" }, IMAGE_PART] });
      expect(state.attachmentInserts).toEqual([[
        { message_id: "user-message", storage_path: IMAGE, content_type: "image/png", size_bytes: 2, position: 0 },
      ]]);
      expect(state.events[0]).toMatchObject({ outcome: "success", error_code: null });
    });

    it("accepts a question that is only an image", async () => {
      const { body } = await run(true, { message: "", imagePaths: [IMAGE] });
      expect(body).toContain("event: final");
      expect(state.events[0]).toMatchObject({ outcome: "success", query_text: "" });
    });

    it("still requires text or an image", async () => {
      const { response } = await run(true, { message: "  " });
      expect(response.status).toBe(400);
    });

    it("rejects images outside the student's own folder without reading them", async () => {
      const { response } = await run(true, { imagePaths: ["other/0b6c1d2e-0000-4000-8000-000000000001.png"] });
      expect(response.status).toBe(400);
      expect(state.downloads).toEqual([]);
    });

    it("replays images from earlier questions in follow-ups", async () => {
      state.history = [
        { id: "answer-1", role: "assistant", content: "It buckles." },
        { id: "question-1", role: "user", content: "" },
      ];
      state.historyAttachments = [{ message_id: "question-1", storage_path: IMAGE, position: 0 }];
      await run(true, { message: "why?" });
      expect(state.modelMessages.slice(1)).toEqual([
        { role: "user", content: [{ type: "text", text: expect.any(String) }, IMAGE_PART] },
        { role: "assistant", content: "It buckles." },
        { role: "user", content: "why?" },
      ]);
    });
  });
});
