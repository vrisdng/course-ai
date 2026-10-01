// The single embedding service for ingestion, retrieval and backfills.
// Provider-agnostic: the provider call is injected as an EmbedBatch, and the
// OpenAI binding lives in llm.ts (createOpenAIEmbeddingService). Changing the
// model means changing DEFAULT_EMBEDDING_CONFIG and re-embedding every chunk —
// vectors from different models are not comparable.

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
  // Texts per provider request.
  batchSize: number;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "text-embedding-3-large",
  dimensions: 3072,
  batchSize: 100,
};

// Where vectors from DEFAULT_EMBEDDING_CONFIG are stored and searched.
export const EMBEDDING_COLUMN = "embedding_openai";
export const MATCH_CHUNKS_FUNCTION = "match_chunks_openai";

// Embeds texts in one provider request, returning one vector per text in order.
export type EmbedBatch = (texts: string[], signal?: AbortSignal) => Promise<number[][]>;

export interface EmbedDocumentsOptions {
  signal?: AbortSignal;
  // Called after each batch with the number of texts embedded so far.
  onProgress?: (embeddedCount: number, totalCount: number) => void | Promise<void>;
}

export interface EmbeddingService {
  readonly model: string;
  readonly dimensions: number;
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
  embedDocuments(texts: string[], options?: EmbedDocumentsOptions): Promise<number[][]>;
}

function assertNonBlank(texts: string[]): void {
  const blankIndex = texts.findIndex((text) => !text.trim());
  if (blankIndex !== -1) {
    throw new Error(`Cannot embed empty text at index ${blankIndex}`);
  }
}

function assertVectors(vectors: number[][], expectedCount: number, dimensions: number): void {
  if (vectors.length !== expectedCount) {
    throw new Error(`Embedding provider returned ${vectors.length} vectors for ${expectedCount} texts`);
  }
  const wrongSize = vectors.find((vector) => vector.length !== dimensions);
  if (wrongSize) {
    throw new Error(`Embedding provider returned a vector with ${wrongSize.length} dimensions, expected ${dimensions}`);
  }
}

export function createEmbeddingService(
  embedBatch: EmbedBatch,
  config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG,
): EmbeddingService {
  const embedDocuments = async (texts: string[], options: EmbedDocumentsOptions = {}): Promise<number[][]> => {
    assertNonBlank(texts);

    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += config.batchSize) {
      const batch = texts.slice(start, start + config.batchSize);
      const batchVectors = await embedBatch(batch, options.signal);
      assertVectors(batchVectors, batch.length, config.dimensions);
      vectors.push(...batchVectors);
      await options.onProgress?.(vectors.length, texts.length);
    }
    return vectors;
  };

  return {
    model: config.model,
    dimensions: config.dimensions,
    embedDocuments,
    async embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
      const [vector] = await embedDocuments([text], { signal });
      return vector;
    },
  };
}
