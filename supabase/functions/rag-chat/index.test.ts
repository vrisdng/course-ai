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
  splitSource: false,
  sourceType: null as null | 'pdf' | 'video',
  savedMessages: [] as Array<Record<string, unknown>>,
  savedCitations: [] as Array<Record<string, unknown>>,
  evidenceUpdates: [] as Array<Record<string, unknown>>,
  evidence: null as null | Promise<string>,
  evidenceSignal: null as null | AbortSignal,
  evidenceStarted: false,
  evidenceWriteFails: false,
  evidenceUpdateIds: [] as unknown[],
}));

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (handler: typeof state.handler) => { state.handler = handler; },
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2.49.1", () => ({
  createClient: () => ({
    rpc: async () => ({ data: state.sourceType ? [{
      id: 'chunk', chunk_text: 'query answer evidence', material_id: 'material', student_document_id: null,
      page_number: state.sourceType === 'pdf' ? 2 : null, start_ms: 1000, end_ms: 5000,
      material_type: state.sourceType, material_name: 'Lecture', relevance_score: 0.9,
    }] : [], error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) },
    from: (table: string) => {
      let inserted: Record<string, unknown> | null = null;
      let updated: Record<string, unknown> | null = null;
      const result = () => {
        if (table === 'chunks' && state.splitSource) return { data: [{ id: 'chunk', block_ids: ['block-a', 'block-b'] }], error: null };
        if (table === 'page_blocks' && state.splitSource) return { data: [{ id: 'block-a', text: 'first claim' }, { id: 'block-b', text: 'second claim' }], error: null };
        if (table === 'citations' && inserted) state.savedCitations.push(...inserted as unknown as Array<Record<string, unknown>>);
        if (table === 'citations' && updated) {
          state.evidenceUpdates.push(updated);
          if (state.evidenceWriteFails) return { data: null, error: { message: 'evidence save failed' } };
        }
        if (table === 'material_transcript_segments') return { data: [{
          id: 'segment', segment_index: 0, start_ms: 1000, end_ms: 2000, text: 'query answer evidence',
        }], error: null };
        if (table === "query_events") {
          state.events.push(inserted!);
          return { data: null, error: null };
        }
        if (table === "conversations") return { data: { id: "conversation", course_id: "course", user_id: state.otherOwner ? "other" : "user" }, error: null };
        if (table === 'messages' && inserted && !state.persistenceFails) state.savedMessages.push(inserted);
        if (table === "messages" && inserted) return state.persistenceFails
          ? { data: null, error: { message: "save failed" } }
          : { data: { id: `${inserted.role}-message` }, error: null };
        if (table === "messages") return { data: [], error: null };
        return { data: null, error: null };
      };
      const builder = {
        select: () => builder, eq: (key: string, value: unknown) => {
          if (table === 'citations' && updated && key === 'id') state.evidenceUpdateIds.push(value);
          return builder;
        }, order: () => builder, limit: () => builder,
        in: () => builder, gte: () => builder, lte: () => builder, range: () => builder,
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
    return { text: state.splitSource ? "first <<cite:1a>> second <<cite:1b>>" : state.sourceType ? "answer <<cite:1>>" : "answer", usage: { promptTokens: 20, completionTokens: 4 } };
  },
  generateChatText: async (options: { signal: AbortSignal }) => {
    state.evidenceStarted = true;
    state.evidenceSignal = options.signal;
    return state.evidence ?? '{"citations":[{"citation":1,"segmentIndices":[0]}]}';
  },
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
    state.sourceType = null;
    state.splitSource = false;
    state.savedMessages = [];
    state.savedCitations = [];
    state.evidenceUpdates = [];
    state.evidence = null;
    state.evidenceSignal = null;
    state.evidenceStarted = false;
    state.evidenceWriteFails = false;
    state.evidenceUpdateIds = [];
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

  it.each(['pdf', 'video'] as const)('delivers saved %s basics before optional evidence finishes', async (sourceType) => {
    state.sourceType = sourceType;
    let resolveEvidence!: (value: string) => void;
    state.evidence = new Promise((resolve) => { resolveEvidence = resolve; });
    const response = await state.handler!(new Request('http://localhost/rag-chat', {
      method: 'POST', headers: { Authorization: 'Bearer test' },
      body: JSON.stringify({ message: 'query', conversationId: 'conversation' }),
    }));
    const reader = response.body!.getReader();
    let body = '';
    const reading = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        body += new TextDecoder().decode(value);
      }
    })();
    try {
      await vi.waitFor(() => expect(body).toContain('event: ready'));
      expect(state.savedMessages).toHaveLength(2);
      expect(state.savedCitations).toHaveLength(1);
      expect(state.savedCitations[0]).toMatchObject({ chunk_id: 'chunk', evidence_segments: null });
      expect(body).toContain('"evidenceSegments":null');
      expect(state.evidenceStarted).toBe(sourceType === 'video');
      if (sourceType === 'video') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(body).not.toContain('event: citations');
        expect(state.events).toHaveLength(0);
      }
    } finally {
      resolveEvidence('{"citations":[{"citation":1,"segmentIndices":[0,999]}]}');
      await reading;
    }
    if (sourceType === 'video') {
      expect(body).toContain('event: citations');
      expect(body.indexOf('event: final')).toBeLessThan(body.indexOf('event: citations'));
      expect(state.evidenceUpdates[0].evidence_segments).toEqual([expect.objectContaining({ id: 'segment' })]);
      expect(state.evidenceUpdateIds).toEqual([state.savedCitations[0].id]);
      expect(state.savedCitations[0].id).toMatch(/^[a-f0-9-]{36}$/);
    } else {
      expect(body).not.toContain('event: citations');
      expect(state.evidenceUpdates).toEqual([]);
    }
  });

  it.each(['cancel', 'model-failure', 'invalid-evidence', 'write-failure'] as const)('keeps saved basics after optional evidence %s', async (ending) => {
    state.sourceType = 'video';
    state.evidenceWriteFails = ending === 'write-failure';
    let finishEvidence!: (value: string) => void;
    let failEvidence!: (error: Error) => void;
    state.evidence = new Promise((resolve, reject) => { finishEvidence = resolve; failEvidence = reject; });
    const response = await state.handler!(new Request('http://localhost/rag-chat', {
      method: 'POST', headers: { Authorization: 'Bearer test' },
      body: JSON.stringify({ message: 'query', conversationId: 'conversation' }),
    }));
    const reader = response.body!.getReader();
    let body = '';
    while (!body.includes('event: ready')) {
      const { value, done } = await reader.read();
      if (done) break;
      body += new TextDecoder().decode(value);
    }
    expect(body).toContain('event: final');
    expect(state.savedMessages).toHaveLength(2);
    expect(state.savedCitations).toHaveLength(1);
    await vi.waitFor(() => expect(state.evidenceStarted).toBe(true));
    if (ending === 'cancel') {
      await reader.cancel('next question');
      expect(state.evidenceSignal?.aborted).toBe(true);
      finishEvidence('{"citations":[{"citation":1,"segmentIndices":[0]}]}');
    } else {
      if (ending === 'model-failure') failEvidence(new Error('provider unavailable'));
      else finishEvidence(JSON.stringify({ citations: [{ citation: 1, segmentIndices: [ending === 'write-failure' ? 0 : 999] }] }));
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        body += new TextDecoder().decode(value);
      }
    }
    await vi.waitFor(() => expect(state.events).toHaveLength(1));
    expect(body).not.toContain('event: citations');
    expect(body).not.toContain('event: error');
    expect(state.evidenceUpdates).toHaveLength(ending === 'write-failure' ? 1 : 0);
    expect(state.events[0]).toMatchObject({ outcome: 'success', error_code: null });
    expect(state.savedCitations[0]).toMatchObject({ material_id: 'material', start_ms: 1000, end_ms: 5000, evidence_segments: null });
  });

  it('persists distinct citation IDs when two claims cite different blocks of one chunk', async () => {
    state.sourceType = 'video';
    state.splitSource = true;
    state.evidence = Promise.resolve('{"citations":[{"citation":1,"segmentIndices":[0]},{"citation":2,"segmentIndices":[0]}]}');
    const { body } = await run(false);
    expect(body).toContain('event: citations');
    expect(state.savedCitations).toHaveLength(2);
    expect(state.savedCitations.map((citation) => citation.chunk_id)).toEqual(['chunk', 'chunk']);
    expect(state.savedCitations.map((citation) => citation.block_ids)).toEqual([['block-a'], ['block-b']]);
    expect(new Set(state.savedCitations.map((citation) => citation.id)).size).toBe(2);
    expect(state.evidenceUpdateIds).toEqual(state.savedCitations.map((citation) => citation.id));
  });

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
    expect(body).toContain("message_persistence_failed");
    expect(body).not.toContain("event: ready");
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
