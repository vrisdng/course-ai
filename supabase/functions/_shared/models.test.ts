import { describe, expect, it } from "vitest";

import { DEFAULT_EMBEDDING_CONFIG } from "./embeddings.ts";
import {
  CHAT_TIER_MODELS,
  OPENAI_MODELS,
  TASK_MODELS,
  findModelSpec,
  resolveReasoningEffort,
} from "./models.ts";

describe("CHAT_TIER_MODELS", () => {
  it("maps each answer tier to the current GPT model for its speed/capability", () => {
    expect(CHAT_TIER_MODELS.fast.id).toBe("gpt-6-luna");
    expect(CHAT_TIER_MODELS.smart.id).toBe("gpt-6.1-sol");
    expect(CHAT_TIER_MODELS.pro.id).toBe("gpt-6-astra");
  });

  it("names each tier's model for display", () => {
    expect(CHAT_TIER_MODELS.fast.name).toBe("GPT-6 Luna");
    expect(CHAT_TIER_MODELS.smart.name).toBe("GPT-6.1 Sol");
    expect(CHAT_TIER_MODELS.pro.name).toBe("GPT-6 Astra");
  });

  it("does not run every tier on the same model", () => {
    const ids = new Set(Object.values(CHAT_TIER_MODELS).map((spec) => spec.id));
    expect(ids.size).toBe(3);
  });
});

describe("TASK_MODELS", () => {
  it("runs the high-volume background calls on the efficient model", () => {
    expect(TASK_MODELS.documentOcr.id).toBe("gpt-6-luna");
    expect(TASK_MODELS.flashcards.id).toBe("gpt-6-luna");
    expect(TASK_MODELS.analyticsChat.id).toBe("gpt-6-luna");
    expect(TASK_MODELS.videoEvidence.id).toBe("gpt-6-luna");
  });
});

describe("configured models", () => {
  const configured = [...Object.values(CHAT_TIER_MODELS), ...Object.values(TASK_MODELS)];

  it("all come from the registry, so every call gets a known request shape", () => {
    for (const spec of configured) {
      expect(findModelSpec(spec.id)).toBe(spec);
    }
  });

  it("no longer include the GPT-5.6 models", () => {
    for (const spec of configured) {
      expect(spec.id).not.toMatch(/^gpt-5/);
    }
  });

  it("leave the embedding model and vector size unchanged", () => {
    expect(DEFAULT_EMBEDDING_CONFIG.model).toBe("text-embedding-3-large");
    expect(DEFAULT_EMBEDDING_CONFIG.dimensions).toBe(3072);
    expect(findModelSpec(DEFAULT_EMBEDDING_CONFIG.model)).toBeUndefined();
  });
});

describe("findModelSpec", () => {
  it("returns undefined for models outside the registry", () => {
    expect(findModelSpec("gpt-5.6-luna")).toBeUndefined();
    expect(findModelSpec("gpt-6-terra")).toBeUndefined();
  });
});

describe("resolveReasoningEffort", () => {
  it("leaves the effort unset when none is requested (the model's own default applies)", () => {
    expect(resolveReasoningEffort(OPENAI_MODELS.sol, undefined)).toBeUndefined();
  });

  it("passes through a documented effort", () => {
    expect(resolveReasoningEffort(OPENAI_MODELS.astra, "high")).toBe("high");
    expect(resolveReasoningEffort(OPENAI_MODELS.luna, "none")).toBe("none");
  });

  it("uses low in place of minimal, as OpenAI's migration guide says", () => {
    expect(resolveReasoningEffort(OPENAI_MODELS.sol, "minimal")).toBe("low");
    expect(resolveReasoningEffort(OPENAI_MODELS.luna, "minimal")).toBe("low");
  });

  it("rejects an effort the model does not support instead of sending a request that fails", () => {
    expect(() => resolveReasoningEffort(OPENAI_MODELS.astra, "none")).toThrowError(/gpt-6-astra.*none/);
    expect(() => resolveReasoningEffort(OPENAI_MODELS.sol, "none")).toThrowError(/gpt-6\.1-sol.*none/);
  });
});
