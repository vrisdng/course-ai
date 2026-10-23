import { describe, expect, it, vi } from "vitest";
import { ChatTelemetry, classifyChatFailure, finishChatTelemetry, type ChatTelemetryFields } from "./chatTelemetry";

function setup() {
  let now = 0;
  const telemetry = new ChatTelemetry("test-request", false, () => now);
  return { telemetry, tick: (ms: number) => { now += ms; } };
}

describe("chat telemetry", () => {
  it("sums searches and records failed phase time, counts and first visible text", async () => {
    const { telemetry, tick } = setup();
    telemetry.recordToolCall();
    telemetry.recordSearch();
    await telemetry.measure("embedding", async () => { tick(10); });
    await telemetry.measure("retrieval", async () => { tick(20); });
    telemetry.recordSearch();
    await expect(telemetry.measure("embedding", async () => { tick(5); throw new Error("failed"); })).rejects.toThrow();
    telemetry.recordFirstToken("");
    telemetry.recordFirstToken("Searching...");
    tick(5);
    telemetry.recordFirstToken("Retained answer");
    expect(telemetry.finish("error", "Error")).toMatchObject({
      embedding_ms: 15, retrieval_ms: 20, first_token_ms: 35,
      search_count: 2, tool_call_count: 1, latency_ms: 40, outcome: "error",
      prompt_tokens: null, completion_tokens: null,
    });
  });

  it("generation includes tool time, while delivery latency excludes persistence", async () => {
    const { telemetry, tick } = setup();
    telemetry.setModel("model", "fast");
    await telemetry.measure("generation", async () => {
      tick(10);
      await telemetry.measure("retrieval", async () => { tick(20); });
      tick(10);
    });
    telemetry.recordUsage({ promptTokens: 10, completionTokens: 2 });
    telemetry.recordUsage({ promptTokens: 5, completionTokens: 3 });
    telemetry.recordAnswerDelivered();
    tick(100);
    expect(telemetry.finish("success", "message_persistence_failed")).toMatchObject({
      model_id: "model", model_tier: "fast", generation_ms: 40,
      retrieval_ms: 20, latency_ms: 40, outcome: "success",
      error_code: "message_persistence_failed", prompt_tokens: 15, completion_tokens: 5,
    });
  });

  it("writes a terminal event once even with concurrent finalization", async () => {
    const { telemetry } = setup();
    const write = vi.fn(async (_fields: ChatTelemetryFields) => {});
    await Promise.all([
      finishChatTelemetry(telemetry, write, "aborted", "client_aborted"),
      finishChatTelemetry(telemetry, write, "error", "Error"),
    ]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ outcome: "aborted" });
  });

  it("does not turn a delivered answer into a failure when telemetry storage fails", async () => {
    const { telemetry } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.fn(async (_fields: ChatTelemetryFields) => { throw new Error("database unavailable"); });
    await expect(finishChatTelemetry(telemetry, write, "success", "message_persistence_failed")).resolves.toBeUndefined();
    await finishChatTelemetry(telemetry, write, "error", "Error");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ outcome: "success", error_code: "message_persistence_failed" });
    log.mockRestore();
  });

  it("uses the abort signal even if a provider wrapped the AbortError", () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyChatFailure(new Error("Chat API error: aborted"), controller.signal))
      .toEqual({ outcome: "aborted", errorCode: "client_aborted" });
    expect(classifyChatFailure(Object.assign(new Error("private provider text"), { status: 429 })))
      .toEqual({ outcome: "error", errorCode: "http_429" });
    expect(classifyChatFailure(new Error("private provider text")))
      .toEqual({ outcome: "error", errorCode: "Error" });
  });
});
