// Course search as a model tool (agentic RAG). The answer model calls the
// search tool as often as it needs. Every chunk it is shown gets one source
// number for the whole answer, kept in a SourceRegistry, so <<cite:N>> (and
// block citations like <<cite:3b>>) mean the same thing however many searches
// ran, and a chunk found twice is never numbered twice.
import { clipText, formatLabelledBlocks, sourceLabel } from "./citations.ts";

export interface SearchableChunk {
  id: string;
  chunk_text: string;
  material_id: string | null;
  student_document_id: string | null;
  page_number: number | null;
  start_ms: number | null;
  end_ms: number | null;
  relevance_score: number;
  material_name?: string;
  material_type?: string;
  document_name?: string;
  document_type?: string;
}

export interface NumberedSource<T extends SearchableChunk = SearchableChunk> {
  number: number;
  chunk: T;
  // First time this answer has seen the chunk.
  isNew: boolean;
}

// Default upper bound on distinct sources in one answer, so repeated searches
// can't grow the context without limit.
export const MAX_SOURCES_PER_ANSWER = 24;

// A source limit that never drops a later search's results: room for every
// allowed search to return a full set of new sources.
export function sourceLimitForSearches(maxSearches: number, resultsPerSearch: number): number {
  return Math.max(1, maxSearches * resultsPerSearch);
}

export class SourceRegistry<T extends SearchableChunk = SearchableChunk> {
  private readonly numbers = new Map<string, number>();
  private readonly chunks: T[] = [];

  constructor(private readonly limit = MAX_SOURCES_PER_ANSWER) {}

  // Registers found chunks and returns them with their source numbers. A chunk
  // seen before keeps its number; new chunks past the limit are left out.
  add(found: T[]): NumberedSource<T>[] {
    const result: NumberedSource<T>[] = [];
    for (const chunk of found) {
      const known = this.numbers.get(chunk.id);
      if (known !== undefined) {
        result.push({ number: known, chunk, isNew: false });
        continue;
      }
      if (this.chunks.length >= this.limit) continue;
      this.chunks.push(chunk);
      this.numbers.set(chunk.id, this.chunks.length);
      result.push({ number: this.chunks.length, chunk, isNew: true });
    }
    return result;
  }

  // All sources in number order: index i is source i + 1.
  list(): T[] {
    return [...this.chunks];
  }

  get size(): number {
    return this.chunks.length;
  }
}

export interface SourceBodyInput {
  number: number;
  chunkText: string;
  // The chunk's page blocks, when it has them (PDF sources).
  blockTexts?: string[];
  maxChars: number;
  hasImage?: boolean;
}

export interface SourceBody {
  text: string;
  // Leading blocks shown, labelled a, b, ... (0 when shown as plain text).
  shownBlockCount: number;
}

// What the model sees of one source: its blocks labelled [3a], [3b]... so
// parts can be cited, or its clipped text, plus an image token for images.
export function formatSourceBody(input: SourceBodyInput): SourceBody {
  let text: string;
  let shownBlockCount = 0;
  if (input.blockTexts && input.blockTexts.length > 0) {
    const labelled = formatLabelledBlocks(input.number, input.blockTexts, input.maxChars);
    text = labelled.text;
    shownBlockCount = labelled.shownCount;
  } else {
    text = clipText(input.chunkText, input.maxChars);
  }
  if (input.hasImage) text += `\nImage reference token: img-source-${input.number}`;
  return { text, shownBlockCount };
}

export interface CourseSearchDeps<T extends SearchableChunk> {
  search(query: string): Promise<T[]>;
  registry: SourceRegistry<T>;
  // Prepares sources numbered for the first time (page blocks, image
  // references) before any of them are rendered.
  prepare(newSources: NumberedSource<T>[]): Promise<void>;
  renderBody(source: NumberedSource<T>): string;
}

// What the search tool returns to the model for one query.
export async function runCourseSearch<T extends SearchableChunk>(query: string, deps: CourseSearchDeps<T>): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) {
    return "Empty search query. Search again with the words to look for.";
  }
  const found = await deps.search(trimmed);
  const sources = deps.registry.add(found);
  // Matches the registry had no room for (search results are unique by id).
  const leftOut = found.length - sources.length;
  if (sources.length === 0) {
    if (leftOut > 0) {
      return `This answer already holds the most sources it can, so the ${leftOut} match(es) for "${trimmed}" can't be shown. Answer from the sources you already have.`;
    }
    return `No course material matched "${trimmed}". Try different wording, or tell the student the materials don't cover it.`;
  }
  const fresh = sources.filter((source) => source.isNew);
  if (fresh.length > 0) await deps.prepare(fresh);
  const text = sources
    .map((source) => {
      const type = source.chunk.material_type || source.chunk.document_type || "document";
      return `Source [${source.number}]: ${sourceLabel(source.chunk)} [${type}]\n${deps.renderBody(source)}`;
    })
    .join("\n\n");
  if (leftOut === 0) return text;
  return `${text}\n\n(${leftOut} more matches were left out: this answer already holds the most sources it can.)`;
}
