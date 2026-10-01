import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EMBEDDING_CONFIG,
  EMBEDDING_COLUMN,
  MATCH_CHUNKS_FUNCTION,
  createEmbeddingService,
  type EmbedBatch,
  type EmbeddingConfig,
} from "./embeddings.ts";

const TEST_CONFIG: EmbeddingConfig = { model: "test-model", dimensions: 3, batchSize: 2 };

// Fake provider: each vector encodes the text's length so ordering is checkable.
function fakeEmbedBatch() {
  return vi.fn<EmbedBatch>(async (texts) => texts.map((text) => [text.length, 0, 1]));
}

describe("DEFAULT_EMBEDDING_CONFIG", () => {
  it("uses text-embedding-3-large at its full 3072 dimensions", () => {
    expect(DEFAULT_EMBEDDING_CONFIG).toEqual({
      model: "text-embedding-3-large",
      dimensions: 3072,
      batchSize: 100,
    });
  });

  it("names the vector column and match function that hold this model's vectors", () => {
    expect(EMBEDDING_COLUMN).toBe("embedding_openai");
    expect(MATCH_CHUNKS_FUNCTION).toBe("match_chunks_openai");
  });
});

describe("createEmbeddingService", () => {
  it("exposes the configured model and dimensions", () => {
    const service = createEmbeddingService(fakeEmbedBatch(), TEST_CONFIG);
    expect(service.model).toBe("test-model");
    expect(service.dimensions).toBe(3);
  });

  it("defaults to DEFAULT_EMBEDDING_CONFIG", () => {
    const service = createEmbeddingService(fakeEmbedBatch());
    expect(service.model).toBe(DEFAULT_EMBEDDING_CONFIG.model);
    expect(service.dimensions).toBe(DEFAULT_EMBEDDING_CONFIG.dimensions);
  });

  describe("embedQuery", () => {
    it("embeds a single text and passes the abort signal through", async () => {
      const embedBatch = fakeEmbedBatch();
      const signal = new AbortController().signal;
      const service = createEmbeddingService(embedBatch, TEST_CONFIG);

      await expect(service.embedQuery("hello", signal)).resolves.toEqual([5, 0, 1]);
      expect(embedBatch).toHaveBeenCalledWith(["hello"], signal);
    });

    it("rejects blank text without calling the provider", async () => {
      const embedBatch = fakeEmbedBatch();
      const service = createEmbeddingService(embedBatch, TEST_CONFIG);

      await expect(service.embedQuery("   ")).rejects.toThrow(/empty text/i);
      expect(embedBatch).not.toHaveBeenCalled();
    });
  });

  describe("embedDocuments", () => {
    it("returns no vectors for no texts without calling the provider", async () => {
      const embedBatch = fakeEmbedBatch();
      const service = createEmbeddingService(embedBatch, TEST_CONFIG);

      await expect(service.embedDocuments([])).resolves.toEqual([]);
      expect(embedBatch).not.toHaveBeenCalled();
    });

    it("splits input into batches of batchSize and keeps input order", async () => {
      const embedBatch = fakeEmbedBatch();
      const service = createEmbeddingService(embedBatch, TEST_CONFIG);

      const vectors = await service.embedDocuments(["a", "bb", "ccc", "dddd", "eeeee"]);

      expect(embedBatch.mock.calls.map(([texts]) => texts)).toEqual([["a", "bb"], ["ccc", "dddd"], ["eeeee"]]);
      expect(vectors.map((vector: number[]) => vector[0])).toEqual([1, 2, 3, 4, 5]);
    });

    it("reports cumulative progress after each batch", async () => {
      const onProgress = vi.fn();
      const service = createEmbeddingService(fakeEmbedBatch(), TEST_CONFIG);

      await service.embedDocuments(["a", "b", "c"], { onProgress });

      expect(onProgress.mock.calls).toEqual([[2, 3], [3, 3]]);
    });

    it("passes the abort signal to every batch", async () => {
      const embedBatch = fakeEmbedBatch();
      const signal = new AbortController().signal;
      const service = createEmbeddingService(embedBatch, TEST_CONFIG);

      await service.embedDocuments(["a", "b", "c"], { signal });

      expect(embedBatch.mock.calls.every(([, passedSignal]) => passedSignal === signal)).toBe(true);
    });

    it("rejects a blank text up front, naming its index", async () => {
      const embedBatch = fakeEmbedBatch();
      const service = createEmbeddingService(embedBatch, TEST_CONFIG);

      await expect(service.embedDocuments(["a", " \n ", "c"])).rejects.toThrow(/empty text at index 1/i);
      expect(embedBatch).not.toHaveBeenCalled();
    });

    it("rejects a provider response with the wrong number of vectors", async () => {
      const service = createEmbeddingService(async () => [[1, 2, 3]], TEST_CONFIG);

      await expect(service.embedDocuments(["a", "b"])).rejects.toThrow(/returned 1 vectors for 2 texts/i);
    });

    it("rejects vectors whose length does not match the configured dimensions", async () => {
      const service = createEmbeddingService(async (texts: string[]) => texts.map(() => [1, 2]), TEST_CONFIG);

      await expect(service.embedDocuments(["a"])).rejects.toThrow(/2 dimensions, expected 3/i);
    });

    it("propagates provider errors", async () => {
      const service = createEmbeddingService(async () => {
        throw new Error("provider down");
      }, TEST_CONFIG);

      await expect(service.embedDocuments(["a"])).rejects.toThrow("provider down");
    });
  });
});
