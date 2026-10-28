// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  agentAnswer: "",
  agentSystemPrompt: "",
  video: false,
  transcriptError: false,
  toolText: "",
  savedCitations: [] as Array<Record<string, unknown>>,
  generateChatText: null as null | ReturnType<typeof vi.fn>,
}));

const MATERIAL_ID = "11111111-1111-4111-8111-111111111111";

const CHUNK = {
  id: "chunk-1",
  chunk_text: "Linear probing places a colliding key in the next free slot.",
  material_id: MATERIAL_ID,
  student_document_id: null,
  page_number: 3,
  start_ms: null,
  end_ms: null,
  relevance_score: 0.9,
  similarity: 0.9,
  material_name: "Hashing notes",
  material_type: "pdf",
};

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (handler: typeof state.handler) => { state.handler = handler; },
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2.49.1", () => ({
  createClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "is_enrolled" || name === "is_admin") return { data: true, error: null };
      return { data: [{ ...CHUNK, ...(state.video ? { material_type: "video", start_ms: 0, end_ms: 3000 } : {}) }], error: null };
    },
    auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) },
    from: (table: string) => {
      let inserted: Record<string, unknown> | null = null;
      const result = () => {
        if (table === "citations" && inserted) state.savedCitations = inserted as unknown as Array<Record<string, unknown>>;
        if (table === "material_transcript_segments" && state.transcriptError) return { data: null, error: { message: "unavailable" } };
        if (table === "material_transcript_segments") return { data: [
          { id: 'seg-a', segment_index: 0, start_ms: 0, end_ms: 1000, text: 'Unrelated introduction.' },
          { id: 'seg-b', segment_index: 1, start_ms: 1000, end_ms: 3000, text: CHUNK.chunk_text },
        ], error: null };
        if (table === "conversations") return { data: { id: "conversation", course_id: "course", user_id: "user" }, error: null };
        if (table === "messages" && inserted) return { data: { id: `${inserted.role}-message` }, error: null };
        if (table === "materials") return { data: [{ id: MATERIAL_ID, file_name: "Hashing notes", file_type: "pdf", file_path: "notes.pdf" }], error: null };
        if (table === "messages" || table === "chunks" || table === "page_blocks") return { data: [], error: null };
        return { data: null, error: null };
      };
      const builder = {
        select: () => builder, eq: () => builder, in: () => builder, order: () => builder, limit: () => builder,
        abortSignal: () => builder, gte: () => builder, lte: () => builder, range: () => builder, update: () => builder,
        insert: (payload: Record<string, unknown>) => { inserted = payload; return builder; },
        single: async () => result(), maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  }),
}));
vi.mock("../_shared/llm.ts", () => {
  state.generateChatText = vi.fn(async () => ({ text: "Linear probing <<cite:1>>.", usage: null }));
  return {
    HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
    createOpenAIEmbeddingService: () => ({ model: "embedding", embedQuery: async () => [1] }),
    generateAgentTextStream: async (options: {
      messages: Array<{ role: string; content: string }>;
      tool: { execute: (query: string) => Promise<string> };
      onToolCall: (query: string) => void;
      onTextDelta: (text: string) => void;
    }) => {
      state.agentSystemPrompt = options.messages[0].content;
      options.onToolCall("hashing");
      state.toolText = await options.tool.execute("hashing");
      options.onTextDelta(state.agentAnswer);
      return { text: state.agentAnswer, usage: null };
    },
    generateChatText: state.generateChatText,
    generateChatTextStream: vi.fn(),
  };
});

interface FinalEvent {
  answer: string;
  citations: Array<{ materialId?: string | null; evidenceSegments?: Array<{ id: string }>; blockIds?: string[] }>;
}

async function ask(body: Record<string, unknown>): Promise<FinalEvent> {
  const response = await state.handler!(new Request("http://localhost/rag-chat", {
    method: "POST",
    headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
    body: JSON.stringify({ message: "What is photosynthesis?", conversationId: "conversation", courseId: "course", ...body }),
  }));
  const text = await response.text();
  const finalBlock = text.split("\n\n").find((block) => block.startsWith("event: final"));
  expect(finalBlock, text).toBeDefined();
  return JSON.parse(finalBlock!.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as FinalEvent;
}

describe("rag-chat answer citations", () => {
  beforeEach(async () => {
    state.video = false;
    state.transcriptError = false;
    state.toolText = "";
    state.savedCitations = [];
    state.rpcCalls = [];
    state.agentSystemPrompt = "";
    state.generateChatText?.mockClear();
    vi.stubGlobal("Deno", { env: { get: () => "test" } });
    await import("./index");
  });

  it("shows labelled transcript segments and persists the cited segment without another model call", async () => {
    state.video = true;
    state.agentAnswer = "Linear probing uses the next free slot <<cite:1b>>.";
    const final = await ask({});
    expect(state.toolText).toContain('[1b] Linear probing');
    expect(final.answer).toContain('<<cite:1>>');
    expect(final.citations[0].evidenceSegments?.map((segment) => segment.id)).toEqual(['seg-b']);
    expect(final.citations[0].blockIds).toEqual([]);
    expect(state.savedCitations[0].evidence_segments).toEqual(final.citations[0].evidenceSegments);
    expect(state.generateChatText).not.toHaveBeenCalled();
  });

  it("keeps distinct claims on the same video attached to their own segments", async () => {
    state.video = true;
    state.agentAnswer = "Introduction <<cite:1a>>. Linear probing <<cite:1b>>.";
    const final = await ask({});
    expect(final.citations.map((citation) => citation.evidenceSegments?.map((segment) => segment.id))).toEqual([['seg-a'], ['seg-b']]);
    expect(final.answer).toBe('Introduction <<cite:1>>. Linear probing <<cite:2>>.');
  });

  it("still answers with an approximate source when transcript loading fails", async () => {
    state.video = true;
    state.transcriptError = true;
    state.agentAnswer = "Linear probing <<cite:1>>.";
    const final = await ask({});
    expect(final.citations[0].evidenceSegments).toBeNull();
    expect(state.toolText).not.toContain('[1b]');
    expect(state.generateChatText).not.toHaveBeenCalled();
  });

  it.each(['1', '1z'])("keeps a video citation without a valid segment label approximate: %s", async (label) => {
    state.video = true;
    state.agentAnswer = `Linear probing <<cite:${label}>>.`;
    const final = await ask({});
    expect(final.citations[0].evidenceSegments).toBeNull();
    expect(state.generateChatText).not.toHaveBeenCalled();
  });

  it("keeps an uncited general-knowledge answer uncited, with no second citation pass", async () => {
    state.agentAnswer = "I couldn't find this in your course materials, but based on general knowledge: plants turn light into sugar.";

    const final = await ask({});

    expect(final.answer).toBe(state.agentAnswer);
    expect(final.citations).toEqual([]);
    expect(state.generateChatText).not.toHaveBeenCalled();
    expect(state.agentSystemPrompt).toContain("NOT IN THE MATERIALS:");
    expect(state.agentSystemPrompt).toContain("answer from general knowledge without any citations");
    expect(state.agentSystemPrompt).not.toContain("suggest the student search online");
    expect(state.agentSystemPrompt).toContain("DOCUMENT SCOPE: No document filter is active.");
  });

  it("still resolves the citation markers the model wrote", async () => {
    state.agentAnswer = "Linear probing uses the next free slot <<cite:1>>.";

    const final = await ask({});

    expect(final.answer).toContain("<<cite:1>>");
    expect(final.citations).toHaveLength(1);
    expect(final.citations[0]).toMatchObject({ materialId: MATERIAL_ID });
    expect(state.generateChatText).not.toHaveBeenCalled();
  });

  it("drops citation markers for sources the model was never shown", async () => {
    state.agentAnswer = "Linear probing uses the next free slot <<cite:7>>.";

    const final = await ask({});

    expect(final.answer).not.toContain("<<cite:7>>");
    expect(final.citations).toEqual([]);
    expect(state.generateChatText).not.toHaveBeenCalled();
  });

  it("restricts searches to the selected documents and tells the model to stay in them", async () => {
    state.agentAnswer = "The answer is not available in the selected documents.";

    const final = await ask({ selectedDocumentIds: [MATERIAL_ID] });

    const searches = state.rpcCalls.filter((call) => call.args.query_embedding !== undefined);
    expect(searches).toHaveLength(1);
    expect(searches[0].args.selected_material_ids).toEqual([MATERIAL_ID]);
    expect(state.agentSystemPrompt).toContain("DOCUMENT SCOPE: The user selected a document filter.");
    expect(state.agentSystemPrompt).toContain("say the answer is not available in the selected documents");
    expect(state.agentSystemPrompt).toContain("If a document filter is active, follow DOCUMENT SCOPE instead and don't answer from general knowledge.");
    expect(final.citations).toEqual([]);
    expect(state.generateChatText).not.toHaveBeenCalled();
  });
});
