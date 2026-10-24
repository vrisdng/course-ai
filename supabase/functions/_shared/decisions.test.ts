import { describe, expect, it, vi } from "vitest";
import {
  DECISIONS_MODEL,
  createDecisionsClient,
  parseDecisionResponse,
  type DecisionRequest,
} from "./decisions.ts";

const request: DecisionRequest = {
  model: DECISIONS_MODEL,
  input: "Is this a question?",
  questions: [{ type: "predicate", name: "is_question", instructions: "Is it a question?" }],
};

const okBody = {
  model: "gpt-6-luna",
  answers: [{ type: "predicate", name: "is_question", probability: 0.9 }],
  usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("parseDecisionResponse", () => {
  it("keeps predicate, choice, score and refusal answers", () => {
    const parsed = parseDecisionResponse({
      model: "gpt-6-luna",
      answers: [
        { type: "predicate", name: "p", probability: 0.25 },
        {
          type: "choice",
          name: "c",
          choice: "b",
          probabilities: [{ value: "a", probability: 0.1 }, { value: "b", probability: 0.9 }],
          confidence: 0.8,
        },
        { type: "score", name: "s", score: 1.5, confidence: 0.6, probabilities: [] },
        { type: "refusal", name: "r" },
      ],
      usage: { input_tokens: 40 },
    });
    expect(parsed.answers).toEqual([
      { type: "predicate", name: "p", probability: 0.25 },
      { type: "choice", name: "c", choice: "b", confidence: 0.8, probabilities: [{ value: "a", probability: 0.1 }, { value: "b", probability: 0.9 }] },
      { type: "score", name: "s", score: 1.5, confidence: 0.6 },
      { type: "refusal", name: "r" },
    ]);
    expect(parsed.inputTokens).toBe(40);
  });

  it("treats malformed answers as refusals instead of trusting them", () => {
    const parsed = parseDecisionResponse({
      answers: [
        { type: "predicate", name: "p", probability: 2 },
        { type: "choice", name: "c", choice: 7 },
        { type: "mystery", name: "m" },
        "not an object",
      ],
    });
    expect(parsed.answers).toEqual([
      { type: "refusal", name: "p" },
      { type: "refusal", name: "c" },
      { type: "refusal", name: "m" },
    ]);
    expect(parsed.inputTokens).toBeNull();
  });

  it("rejects a body without answers", () => {
    expect(() => parseDecisionResponse({ error: "nope" })).toThrow("Decisions API returned no answers");
    expect(() => parseDecisionResponse(null)).toThrow("Decisions API returned no answers");
  });
});

describe("createDecisionsClient", () => {
  it("posts the request with the API key and parses the answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okBody));
    const decide = createDecisionsClient("sk-test", { fetchImpl });
    const result = await decide(request);

    expect(result.answers).toEqual([{ type: "predicate", name: "is_question", probability: 0.9 }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/decisions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "slow down" } }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Decision admission timed out" } }, 503))
      .mockResolvedValueOnce(jsonResponse(okBody));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const decide = createDecisionsClient("sk-test", { fetchImpl, sleep, maxRetries: 2 });

    await expect(decide(request)).resolves.toMatchObject({ inputTokens: 12 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("surfaces the provider's message and status once retries run out", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Decision admission timed out" } }, 504));
    const decide = createDecisionsClient("sk-test", { fetchImpl, sleep: async () => {}, maxRetries: 1 });

    await expect(decide(request)).rejects.toMatchObject({
      status: 504,
      message: "Decisions API error (504): Decision admission timed out",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    const decide = createDecisionsClient("sk-test", { fetchImpl, sleep: async () => {} });

    await expect(decide(request)).rejects.toMatchObject({ status: 400, message: "Decisions API error (400): bad request" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("passes the abort signal through and does not retry an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const decide = createDecisionsClient("sk-test", { fetchImpl, sleep: async () => {} });

    await expect(decide(request, controller.signal)).rejects.toThrow("aborted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
