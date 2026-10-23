// Block-extraction stage of process-material-job: one batch of rendered page
// images per invocation is read by the OCR model into blocks (see blocks.ts),
// snapped onto the page's text-layer lines, and saved. Side effects are
// injected so the batch logic is testable without storage or OpenAI.
import { buildBlockExtractionPrompt, parseBlockOutput, snapBlocksToLines, type ExtractedBlock } from "./blocks.ts";
import { MIN_PAGES_PER_CALL, nextExtractionRange, shrinkPagesPerCall } from "./extraction.ts";
import type { PageLine } from "./highlights.ts";
import type { PageImageInput } from "./llmConfig.ts";

// Page images cost far more input than a PDF's text; measured with
// gpt-5.6-luna, 2 dense pages took ~20 s, so 6 stays well inside the OCR call
// timeout (not yet re-measured on gpt-6-luna). A timeout halves the batch for
// the retry.
export const BLOCK_PAGES_PER_CALL = 6;

export interface BlockExtractionState {
  nextPage: number;
  totalPages: number;
  pagesPerCall: number;
}

export interface BlockExtractionDeps {
  loadPageImage(pageNumber: number): Promise<Omit<PageImageInput, "pageNumber">>;
  loadPageLines(pageNumbers: number[]): Promise<Map<number, PageLine[]>>;
  readBlocks(prompt: string, pages: PageImageInput[]): Promise<string>;
  saveBlocks(blocks: ExtractedBlock[]): Promise<void>;
  isTimeout(error: unknown): boolean;
}

export interface BlockExtractionBatchResult {
  state: BlockExtractionState;
  done: boolean;
  // True when the model call timed out: nothing was saved and the batch shrank.
  timedOut: boolean;
  blockCount: number;
}

export function initialBlockExtractionState(totalPages: number): BlockExtractionState {
  return { nextPage: 1, totalPages, pagesPerCall: Math.min(BLOCK_PAGES_PER_CALL, totalPages) };
}

export async function runBlockExtractionBatch(
  state: BlockExtractionState,
  deps: BlockExtractionDeps,
): Promise<BlockExtractionBatchResult> {
  const range = nextExtractionRange(state);
  if (!range) {
    return { state, done: true, timedOut: false, blockCount: 0 };
  }

  const pageNumbers = Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i);
  const [images, linesByPage] = await Promise.all([
    Promise.all(pageNumbers.map(async (pageNumber) => ({ pageNumber, ...(await deps.loadPageImage(pageNumber)) }))),
    deps.loadPageLines(pageNumbers),
  ]);

  let raw: string;
  try {
    raw = await deps.readBlocks(buildBlockExtractionPrompt(range), images);
  } catch (error) {
    if (deps.isTimeout(error) && state.pagesPerCall > MIN_PAGES_PER_CALL) {
      return {
        state: { ...state, pagesPerCall: shrinkPagesPerCall(state.pagesPerCall) },
        done: false,
        timedOut: true,
        blockCount: 0,
      };
    }
    throw error;
  }

  const parsed = parseBlockOutput(raw, range);
  if (parsed.length === 0) {
    throw new Error(`No blocks could be read from pages ${range.start}-${range.end}`);
  }

  const snapped = pageNumbers.flatMap((pageNumber) =>
    snapBlocksToLines(parsed.filter((b) => b.pageNumber === pageNumber), linesByPage.get(pageNumber) ?? []),
  );
  await deps.saveBlocks(snapped);

  const nextState = { ...state, nextPage: range.end + 1 };
  return { state: nextState, done: nextState.nextPage > nextState.totalPages, timedOut: false, blockCount: snapped.length };
}
