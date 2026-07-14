// Query classification, ambiguity detection, and document-scope helpers for rag-chat.
export interface ResolvedSelectedMaterial {
  id: string;
  fileName: string;
}

export type ChatModelTier = "fast" | "smart" | "pro";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AMBIGUOUS_QUERY_MARKERS = [
  /\b(this|that|these|those)\b/i,
  /\b(it|they|them)\b/i,
  /\babove|below|earlier|previous|last one\b/i,
  /\bwhat about\b/i,
  /\bcan you explain this\b/i,
  /\bmore on that\b/i,
];

export function resolveChatModelTier(raw: unknown): ChatModelTier {
  if (raw === "fast" || raw === "smart" || raw === "pro") {
    return raw;
  }
  return "fast";
}

export function normalizeSelectedDocumentIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueIds = new Set<string>();

  for (const rawId of value) {
    if (typeof rawId !== "string") {
      continue;
    }

    const trimmedId = rawId.trim();
    if (!UUID_PATTERN.test(trimmedId)) {
      continue;
    }

    uniqueIds.add(trimmedId);
  }

  return Array.from(uniqueIds);
}

export function formatDocumentNameList(materials: ResolvedSelectedMaterial[]): string {
  if (materials.length === 0) {
    return "the selected documents";
  }

  if (materials.length === 1) {
    return `"${materials[0].fileName}"`;
  }

  if (materials.length === 2) {
    return `"${materials[0].fileName}" and "${materials[1].fileName}"`;
  }

  return `${materials.length} selected documents`;
}

export function buildSelectedDocumentEmptyAnswer(materials: ResolvedSelectedMaterial[]): string {
  return `I couldn't find enough information in ${formatDocumentNameList(materials)} to answer that from the selected documents alone.\n\n## Next step\n\nTry selecting additional documents or switching back to **All course documents** for a broader grounded answer.`;
}

export function isLikelyAmbiguousQuestion(message: string, historyContext: string): boolean {
  if (!historyContext.trim()) {
    return false;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const shortQuestion = wordCount <= 9 || trimmed.length <= 60;
  const hasAmbiguousMarker = AMBIGUOUS_QUERY_MARKERS.some((pattern) => pattern.test(trimmed));

  return shortQuestion || hasAmbiguousMarker;
}

export function classifyQueryCategory(message: string): string {
  const text = message.trim().toLowerCase();

  if (!text) {
    return "other";
  }

  if (/\b(compare|difference|versus|vs\.?|pros and cons)\b/.test(text)) {
    return "comparison";
  }

  if (/\b(how do i|how to|steps|process|procedure|implement|apply)\b/.test(text)) {
    return "how_to_process";
  }

  if (/\b(calculate|compute|equation|formula|derive|proof|solve)\b/.test(text)) {
    return "calculation";
  }

  if (/\b(error|bug|issue|debug|fix|failing|doesn't work|not working)\b/.test(text)) {
    return "troubleshooting";
  }

  if (/\b(what is|define|definition|concept|meaning|explain)\b/.test(text)) {
    return "definition_concept";
  }

  if (/\b(when|where|who|which|list|name)\b/.test(text)) {
    return "factual_lookup";
  }

  return "other";
}

export function inferUnresolvedReason(options: {
  retrievedChunkCount: number;
  citationCount: number;
  answer: string;
}): string | null {
  if (options.retrievedChunkCount === 0) {
    return "no_retrieval";
  }

  if (options.citationCount === 0) {
    return "no_citations";
  }

  const loweredAnswer = options.answer.toLowerCase();
  const materialGapPattern = /(not (?:in|from) (?:the )?(?:provided )?(?:selected )?(?:course )?(?:documents|materials)|not available in (?:the )?(?:provided )?(?:selected )?(?:course )?(?:documents|materials)|cannot find this in (?:the )?(?:selected )?(?:documents|materials))/;
  if (materialGapPattern.test(loweredAnswer)) {
    return "insufficient_materials";
  }

  return null;
}
