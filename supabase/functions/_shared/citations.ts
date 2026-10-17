// Citation token parsing/remapping and source formatting for rag-chat.
import { blockIndexFromLabel, blockLabel } from "./blocks.ts";
export interface CitationSourceChunk {
  material_name?: string;
  material_type?: string;
  document_name?: string;
  document_type?: string;
  chunk_text: string;
  start_ms: number | null;
  end_ms: number | null;
  page_number: number | null;
}

export interface CitationSanitizationResult {
  text: string;
  // Source number of each final citation, in final order (may repeat when one
  // source is cited for different blocks).
  citedChunkNumbers: number[];
  citedRefs: CitedRef[];
}

const CITATION_TOKEN_PATTERN = "<<cite:(\\d+)>>";

export function clipText(value: string, maxLength = 1200): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trim()}...`;
}

export function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function sourceLabel(chunk: CitationSourceChunk): string {
  const name = chunk.material_name || chunk.document_name || "Unknown document";
  if (typeof chunk.start_ms === "number") {
    const start = formatTimestamp(chunk.start_ms);
    const end =
      typeof chunk.end_ms === "number" ? `-${formatTimestamp(chunk.end_ms)}` : "";
    return `${name} (${start}${end})`;
  }

  const pageInfo = chunk.page_number ? ` (Page ${chunk.page_number})` : "";
  return `${name}${pageInfo}`;
}

export function stripTrailingSourcesSection(text: string): string {
  const withoutBlockSources = text.replace(/\n{1,}(?:#{1,6}\s*)?sources\s*:?\s*[\s\S]*$/i, "");
  const withoutInlineSources = withoutBlockSources.replace(/\s+sources\s*:\s*(?:\[\d+\]|\d+\s+\S)[\s\S]*$/i, "");
  return withoutInlineSources.trim();
}

// Number of labelled blocks shown for a source (0 = shown as plain text).
export type BlockCountBySource = (sourceNumber: number) => number;

// A cited source, optionally narrowed to some of its blocks (0-based indexes
// into the blocks shown for it; empty = the whole source).
export interface CitedRef {
  sourceNumber: number;
  blockIndexes: number[];
}

const RAW_CITE_TOKEN = /<<\s*cite\s*:\s*([^<>]*?)\s*>>/gi;
const CANONICAL_CITE_TOKEN = /<<cite:(\d+)((?:[a-z]+)(?:,\d+[a-z]+)*)?>>/g;

function canonicalToken(sourceNumber: number, blockIndexes: number[]): string {
  if (blockIndexes.length === 0) return `<<cite:${sourceNumber}>>`;
  return `<<cite:${blockIndexes.map((i) => `${sourceNumber}${blockLabel(i)}`).join(",")}>>`;
}

// Rewrites every citation marker to a canonical <<cite:3>> or <<cite:3b,3c>>
// (one token per source), dropping unknown sources and unknown block labels. A
// marker listing several sources (<<cite:2,3>>) becomes adjacent tokens. Bare
// [n] / (n) are left as text: the model is told to use <<cite:N>>, and
// converting them would also rewrite maths such as w^{(3)} or O(1).
export function normalizeCitationTokens(
  content: string,
  maxSourceNumber: number,
  blockCountBySource: BlockCountBySource = () => 0,
): string {
  if (maxSourceNumber < 1) {
    return content;
  }

  return content.replace(RAW_CITE_TOKEN, (_, body: string) => {
    const bySource = new Map<number, Set<number> | null>();
    for (const item of body.split(",")) {
      const match = item.trim().toLowerCase().match(/^([1-9]\d*)([a-z]*)$/);
      if (!match) continue;
      const sourceNumber = Number(match[1]);
      if (sourceNumber > maxSourceNumber) continue;
      const index = match[2] ? blockIndexFromLabel(match[2]) : null;
      const isKnownBlock = index !== null && index < blockCountBySource(sourceNumber);
      const existing = bySource.get(sourceNumber);
      if (!isKnownBlock) {
        // A bare number or an unknown label cites the whole source, and the
        // whole source wins over any blocks of it in the same marker.
        bySource.set(sourceNumber, null);
      } else if (existing === undefined) {
        bySource.set(sourceNumber, new Set([index]));
      } else if (existing !== null) {
        existing.add(index);
      }
    }
    return [...bySource.entries()]
      .map(([sourceNumber, indexes]) => canonicalToken(sourceNumber, indexes ? [...indexes].sort((a, b) => a - b) : []))
      .join("");
  });
}

function parseCanonicalToken(sourceNumber: number, blockPart: string | undefined): CitedRef {
  if (!blockPart) return { sourceNumber, blockIndexes: [] };
  const indexes = blockPart
    .split(",")
    .map((item) => blockIndexFromLabel(item.replace(/^\d+/, "")))
    .filter((index): index is number => index !== null);
  return { sourceNumber, blockIndexes: indexes };
}

// Cleans the answer and renumbers its citations densely (1..n) in order of
// first appearance. Each distinct (source, blocks) pair gets its own number,
// so two claims citing different parts of one source get different numbers.
export function sanitizeAndRemapCitations(
  rawAnswer: string,
  maxSourceNumber: number,
  blockCountBySource: BlockCountBySource = () => 0,
): CitationSanitizationResult {
  const cleanedAnswer = stripTrailingSourcesSection(rawAnswer.trim());
  const normalizedAnswer = normalizeCitationTokens(cleanedAnswer, maxSourceNumber, blockCountBySource);

  const citedRefs: CitedRef[] = [];
  const numberByKey = new Map<string, number>();
  const remappedAnswer = normalizedAnswer.replace(CANONICAL_CITE_TOKEN, (_, rawNumber: string, blockPart?: string) => {
    const ref = parseCanonicalToken(Number(rawNumber), blockPart);
    const key = `${ref.sourceNumber}:${ref.blockIndexes.join(",")}`;
    let mapped = numberByKey.get(key);
    if (mapped === undefined) {
      citedRefs.push(ref);
      mapped = citedRefs.length;
      numberByKey.set(key, mapped);
    }
    return `<<cite:${mapped}>>`;
  });

  const cleanedRemappedAnswer = remappedAnswer
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();

  return {
    text: cleanedRemappedAnswer,
    citedChunkNumbers: citedRefs.map((ref) => ref.sourceNumber),
    citedRefs,
  };
}

export interface LabelledBlocks {
  text: string;
  // How many leading blocks were shown (labels a.. up to this count).
  shownCount: number;
}

// A source's blocks as the answer model sees them: "[3a] text", one per line,
// within a character budget. Blocks are shown as a leading run so the labels
// stay contiguous; the first block is always shown, clipped if needed.
export function formatLabelledBlocks(sourceNumber: number, texts: string[], maxChars: number): LabelledBlocks {
  const lines: string[] = [];
  let used = 0;
  for (const [index, text] of texts.entries()) {
    if (index > 0 && used + text.length > maxChars) break;
    const shown = index === 0 ? clipText(text, maxChars) : text;
    lines.push(`[${sourceNumber}${blockLabel(index)}] ${shown}`);
    used += shown.length;
  }
  return { text: lines.join("\n"), shownCount: lines.length };
}

export function buildCitationRewriteSourceContext(chunks: CitationSourceChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const sourceType = chunk.material_type || chunk.document_type || "document";
      return [
        `Source ${index + 1}: ${sourceLabel(chunk)} (${sourceType})`,
        clipText(chunk.chunk_text, 900),
      ].join("\n");
    })
    .join("\n\n");
}

// Image file types that can be rendered inline in chat as citation images.
export const IMAGE_MATERIAL_TYPES = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

// Markdown image syntax that references a source image token, e.g.
// ![diagram](img-source-3). Captures the caption (the Markdown alt text) and the
// 1-based source number the token points at.
const IMAGE_TOKEN_PATTERN = /!\[([^\]]*)\]\(img-source-(\d+)\)/g;

// Scans a (already citation-sanitized) answer for image tokens and returns a map
// from source number to caption text. Used to know which cited sources embed an
// image so the backend can attach the stable path to the matching citation.
export function extractCitedImageTokens(text: string): Map<number, string> {
  const tokens = new Map<number, string>();
  for (const match of text.matchAll(IMAGE_TOKEN_PATTERN)) {
    const sourceNumber = Number(match[2]);
    if (Number.isFinite(sourceNumber)) {
      tokens.set(sourceNumber, match[1]);
    }
  }
  return tokens;
}

// Rewrites every `img-source-<n>` reference in the answer to the value the
// resolver returns for that source number. When the resolver returns null the
// token is left untouched, so unknown images silently degrade to plain text.
export function rewriteImageTokens(
  text: string,
  resolver: (sourceNumber: number) => string | null,
): string {
  return text.replace(/img-source-(\d+)/g, (_full, rawNumber) => {
    const sourceNumber = Number(rawNumber);
    if (!Number.isFinite(sourceNumber)) {
      return _full;
    }
    return resolver(sourceNumber) ?? _full;
  });
}
