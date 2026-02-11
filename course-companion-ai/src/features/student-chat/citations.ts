export const getCitationKey = (messageId: string, citationNumber: number) => `${messageId}-${citationNumber}`;

const NON_CITATION_PREVIOUS_WORDS = new Set([
  'step',
  'section',
  'chapter',
  'week',
  'part',
  'item',
  'example',
  'option',
]);

function normalizeLegacyCitationMarkers(content: string, maxCitationNumber?: number): string {
  if (!maxCitationNumber || maxCitationNumber < 1) {
    return content;
  }

  // Convert any existing square brackets to parentheses first to normalize
  const normalized = content.replace(/\[([1-9]\d*)\]/g, '($1)');

  return normalized.replace(/(\S)\s+([1-9]\d*)([.,;!?])?(?=\s|$)/g, (match, previousChar, rawNumber, punctuation, offset, fullText) => {
    const citationNumber = Number(rawNumber);
    if (!Number.isFinite(citationNumber) || citationNumber < 1 || citationNumber > maxCitationNumber) {
      return match;
    }

    const textBeforeMatch = fullText.slice(0, Number(offset) + 1);
    const previousWord = textBeforeMatch.match(/([A-Za-z]+)\s*$/)?.[1]?.toLowerCase();
    if (previousWord && NON_CITATION_PREVIOUS_WORDS.has(previousWord)) {
      return match;
    }

    const punc = punctuation || '';
    return `${previousChar} (${citationNumber})${punc}`;
  });
}

export const markdownWithCitationLinks = (content: string, maxCitationNumber?: number) =>
  normalizeLegacyCitationMarkers(content, maxCitationNumber).replace(/\((\d+)\)/g, '[\\[$1\\]](citation:$1)');
