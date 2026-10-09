// Page blocks behind retrieved chunks, for rag-chat: the answer model sees a
// source's blocks labelled [3a], [3b]... and may cite them individually; the
// resulting citation records the cited block ids. Database reads are injected.

export interface SourceBlock {
  id: string;
  text: string;
}

export interface SourceBlocksDeps {
  fetchChunkBlockIds(chunkIds: string[]): Promise<{ id: string; block_ids: string[] | null }[]>;
  fetchBlocks(blockIds: string[]): Promise<SourceBlock[]>;
}

const EXCERPT_CHARS = 300;

// chunk id → its blocks in the chunk's order. Chunks without blocks (non-PDF
// sources, older uploads) are absent, so callers show them as plain text.
export async function loadSourceBlocks(chunkIds: string[], deps: SourceBlocksDeps): Promise<Map<string, SourceBlock[]>> {
  const result = new Map<string, SourceBlock[]>();
  if (chunkIds.length === 0) return result;

  const chunks = (await deps.fetchChunkBlockIds(chunkIds)).filter((c) => (c.block_ids?.length ?? 0) > 0);
  const allIds = chunks.flatMap((c) => c.block_ids!);
  if (allIds.length === 0) return result;

  const byId = new Map((await deps.fetchBlocks(allIds)).map((b) => [b.id, b]));
  for (const chunk of chunks) {
    const blocks = chunk.block_ids!.map((id) => byId.get(id)).filter((b): b is SourceBlock => Boolean(b));
    if (blocks.length > 0) result.set(chunk.id, blocks);
  }
  return result;
}

export function citedBlockIds(blockIndexes: number[], shown: SourceBlock[]): string[] {
  return blockIndexes.map((index) => shown[index]?.id).filter((id): id is string => Boolean(id));
}

function clip(text: string): string {
  return text.length > EXCERPT_CHARS ? `${text.substring(0, EXCERPT_CHARS)}...` : text;
}

// What the sources panel shows as the "cited passage".
export function citedExcerpt(blockIndexes: number[], shown: SourceBlock[], chunkText: string): string {
  const texts = blockIndexes.map((index) => shown[index]?.text).filter((t): t is string => Boolean(t));
  return clip(texts.length > 0 ? texts.join(" ") : chunkText);
}
