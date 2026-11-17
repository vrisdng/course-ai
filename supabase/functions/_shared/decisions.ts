// Client for OpenAI's Decisions API (POST /v1/decisions): structured yes/no,
// choice and score answers about one input, without generating text.
// Docs: developers.openai.com/api/docs/guides/decisions (checked 2026-10-24).
//
// The AI SDK has no binding for this endpoint, so this is a small fetch
// client. Call it through llm.ts#generateDecisions, like every other LLM call.
// It has no Deno or URL imports so it can be unit tested under vitest.

// The only model the Decisions API supports.
export const DECISIONS_MODEL = "gpt-6-luna";

const DECISIONS_URL = "https://api.openai.com/v1/decisions";

export interface DecisionTextPart {
  type: "input_text";
  text: string;
}

export interface DecisionMessage {
  role: "developer" | "user" | "assistant";
  content: DecisionTextPart[];
}

export interface PredicateQuestion {
  type: "predicate";
  name: string;
  instructions: string;
}

export interface ChoiceQuestion {
  type: "choice";
  name: string;
  instructions: string;
  choices: ReadonlyArray<{ value: string; description: string }>;
}

export interface ScoreQuestion {
  type: "score";
  name: string;
  instructions: string;
  levels: ReadonlyArray<{ label: string; description: string }>;
}

export type DecisionQuestion = PredicateQuestion | ChoiceQuestion | ScoreQuestion;

export interface DecisionRequest {
  model: string;
  input: string | DecisionMessage[];
  questions: DecisionQuestion[];
}

export type DecisionAnswer =
  | { type: "predicate"; name: string; probability: number }
  | {
    type: "choice";
    name: string;
    choice: string;
    confidence: number;
    probabilities: Array<{ value: string; probability: number }>;
  }
  | { type: "score"; name: string; score: number; confidence: number }
  | { type: "refusal"; name: string };

export interface DecisionResult {
  answers: DecisionAnswer[];
  inputTokens: number | null;
}

export class DecisionsApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "DecisionsApiError";
  }
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUnitInterval = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function parseProbabilities(value: unknown): Array<{ value: string; probability: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.value === "string" && isUnitInterval(entry.probability)
      ? [{ value: entry.value, probability: entry.probability }]
      : []
  );
}

// Anything that doesn't have the documented shape becomes a refusal, so a
// malformed answer is never stored as a label.
function parseAnswer(raw: unknown): DecisionAnswer | null {
  if (!isRecord(raw) || typeof raw.name !== "string") return null;
  const name = raw.name;
  if (raw.type === "predicate" && isUnitInterval(raw.probability)) {
    return { type: "predicate", name, probability: raw.probability };
  }
  if (raw.type === "choice" && typeof raw.choice === "string" && isUnitInterval(raw.confidence)) {
    return {
      type: "choice",
      name,
      choice: raw.choice,
      confidence: raw.confidence,
      probabilities: parseProbabilities(raw.probabilities),
    };
  }
  if (raw.type === "score" && typeof raw.score === "number" && Number.isFinite(raw.score) && isUnitInterval(raw.confidence)) {
    return { type: "score", name, score: raw.score, confidence: raw.confidence };
  }
  return { type: "refusal", name };
}

export function parseDecisionResponse(body: unknown): DecisionResult {
  if (!isRecord(body) || !Array.isArray(body.answers)) {
    throw new Error("Decisions API returned no answers");
  }
  const answers = body.answers.map(parseAnswer).filter((answer): answer is DecisionAnswer => answer !== null);
  const usage = isRecord(body.usage) ? body.usage : null;
  const inputTokens = usage && typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  return { answers, inputTokens };
}

export type DecideFn = (request: DecisionRequest, signal?: AbortSignal) => Promise<DecisionResult>;

export interface DecisionsClientOptions {
  fetchImpl?: typeof fetch;
  // Retries for 429 and 5xx (the API answers a busy period with an
  // "admission timed out" error that a retry usually clears).
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRY_BASE_MS = 500;

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } | string };
    if (typeof body.error === "string") return body.error;
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Not JSON: use the text as is.
  }
  return text.slice(0, 300) || response.statusText || "request failed";
}

export function createDecisionsClient(apiKey: string, options: DecisionsClientOptions = {}): DecideFn {
  const fetchImpl = options.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const maxRetries = options.maxRetries ?? 2;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async (request, signal) => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetchImpl(DECISIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
      if (response.ok) {
        return parseDecisionResponse(await response.json());
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        throw new DecisionsApiError(
          response.status,
          `Decisions API error (${response.status}): ${await errorMessage(response)}`,
        );
      }
      await response.body?.cancel().catch(() => undefined);
      await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  };
}
