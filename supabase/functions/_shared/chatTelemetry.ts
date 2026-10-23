import { mergeTokenUsage, type TokenUsage } from "./llmUsage.ts";
import { isAbortError } from "./sse.ts";

export type ChatOutcome = "success" | "error" | "aborted";
type Phase = "embedding" | "retrieval" | "generation";

export interface ChatTelemetryFields {
  request_id: string;
  pipeline_version: string;
  model_id: string | null;
  model_tier: string | null;
  skip_rag: boolean;
  search_count: number;
  tool_call_count: number;
  embedding_ms: number;
  retrieval_ms: number;
  generation_ms: number | null;
  first_token_ms: number | null;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  outcome: ChatOutcome;
  error_code: string | null;
}

export class ChatTelemetry {
  private readonly startedAt: number;
  private deliveredAt: number | null = null;
  private firstTokenMs: number | null = null;
  private finished = false;
  private modelId: string | null = null;
  private modelTier: string | null = null;
  private searches = 0;
  private toolCalls = 0;
  private readonly phases: Record<Phase, number | null> = { embedding: 0, retrieval: 0, generation: null };
  private usage: TokenUsage | null = null;

  constructor(
    private readonly requestId: string,
    private readonly skipRag: boolean,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.startedAt = clock();
  }

  setModel(id: string, tier: string): void { this.modelId = id; this.modelTier = tier; }
  recordSearch(): void { this.searches += 1; }
  recordToolCall(): void { this.toolCalls += 1; }
  recordFirstToken(delta: string): void {
    if (delta && this.firstTokenMs === null) this.firstTokenMs = this.elapsed();
  }
  recordAnswerDelivered(): void { this.deliveredAt = this.elapsed(); }
  recordUsage(usage: TokenUsage): void {
    this.usage = this.usage ? mergeTokenUsage(this.usage, usage) : usage;
  }

  async measure<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
    const start = this.clock();
    try {
      return await work();
    } finally {
      this.phases[phase] = (this.phases[phase] ?? 0) + Math.max(0, this.clock() - start);
    }
  }

  private elapsed(): number { return Math.max(0, Math.round(this.clock() - this.startedAt)); }

  finish(outcome: ChatOutcome, errorCode: string | null = null): ChatTelemetryFields | null {
    if (this.finished) return null;
    this.finished = true;
    return {
      request_id: this.requestId,
      pipeline_version: "agentic-rag-telemetry-v1",
      model_id: this.modelId, model_tier: this.modelTier, skip_rag: this.skipRag,
      search_count: this.searches, tool_call_count: this.toolCalls,
      embedding_ms: Math.round(this.phases.embedding ?? 0),
      retrieval_ms: Math.round(this.phases.retrieval ?? 0),
      generation_ms: this.phases.generation === null ? null : Math.round(this.phases.generation),
      first_token_ms: this.firstTokenMs,
      latency_ms: outcome === "success" ? this.deliveredAt ?? this.elapsed() : this.elapsed(),
      prompt_tokens: this.usage?.promptTokens ?? null,
      completion_tokens: this.usage?.completionTokens ?? null,
      outcome, error_code: errorCode,
    };
  }
}

export function classifyChatFailure(error: unknown, signal?: AbortSignal): { outcome: ChatOutcome; errorCode: string } {
  if (signal?.aborted || isAbortError(error)) return { outcome: "aborted", errorCode: "client_aborted" };
  const status = (error as { status?: number })?.status;
  const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "Error";
  return { outcome: "error", errorCode: Number.isInteger(status) && status! >= 400 && status! <= 599 ? `http_${status}` : name };
}

export async function finishChatTelemetry(
  telemetry: ChatTelemetry,
  write: (fields: ChatTelemetryFields) => Promise<void>,
  outcome: ChatOutcome,
  errorCode: string | null = null,
): Promise<void> {
  const fields = telemetry.finish(outcome, errorCode);
  if (!fields) return;
  try {
    await write(fields);
  } catch (error) {
    console.error("Failed to write chat telemetry", error);
  }
}
