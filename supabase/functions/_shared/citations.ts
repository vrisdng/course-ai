// Citation token parsing/remapping and source formatting for rag-chat.
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
  citedChunkNumbers: number[];
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

export function normalizeCitationTokens(content: string, maxSourceNumber: number): string {
  if (maxSourceNumber < 1) {
    return content;
  }

  let normalized = content.replace(/<<\s*cite\s*:\s*([1-9]\d*)\s*>>/gi, (_, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (citationNumber < 1 || citationNumber > maxSourceNumber) {
      return "";
    }
    return `<<cite:${citationNumber}>>`;
  });

  // Backward compatibility: convert explicit [n] and (n) markers only.
  normalized = normalized.replace(/\[([1-9]\d*)\]/g, (match, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (citationNumber < 1 || citationNumber > maxSourceNumber) {
      return match;
    }
    return `<<cite:${citationNumber}>>`;
  });

  normalized = normalized.replace(/\(([1-9]\d*)\)/g, (match, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (citationNumber < 1 || citationNumber > maxSourceNumber) {
      return match;
    }
    return `<<cite:${citationNumber}>>`;
  });

  return normalized;
}

export function sanitizeAndRemapCitations(rawAnswer: string, maxSourceNumber: number): CitationSanitizationResult {
  const cleanedAnswer = stripTrailingSourcesSection(rawAnswer.trim());
  const normalizedAnswer = normalizeCitationTokens(cleanedAnswer, maxSourceNumber);

  const orderedOriginalCitationNumbers: number[] = [];
  const seenOriginalCitationNumbers = new Set<number>();

  for (const match of normalizedAnswer.matchAll(new RegExp(CITATION_TOKEN_PATTERN, "g"))) {
    const citationNumber = Number(match[1]);
    if (!Number.isFinite(citationNumber) || citationNumber < 1 || citationNumber > maxSourceNumber) {
      continue;
    }
    if (!seenOriginalCitationNumbers.has(citationNumber)) {
      seenOriginalCitationNumbers.add(citationNumber);
      orderedOriginalCitationNumbers.push(citationNumber);
    }
  }

  const remappedCitationNumbers = new Map<number, number>();
  orderedOriginalCitationNumbers.forEach((originalCitationNumber, index) => {
    remappedCitationNumbers.set(originalCitationNumber, index + 1);
  });

  const remappedAnswer = normalizedAnswer.replace(new RegExp(CITATION_TOKEN_PATTERN, "g"), (_, rawNumber) => {
    const citationNumber = Number(rawNumber);
    const mappedCitationNumber = remappedCitationNumbers.get(citationNumber);
    return mappedCitationNumber ? `<<cite:${mappedCitationNumber}>>` : "";
  });

  const cleanedRemappedAnswer = remappedAnswer
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();

  return {
    text: cleanedRemappedAnswer,
    citedChunkNumbers: orderedOriginalCitationNumbers,
  };
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
