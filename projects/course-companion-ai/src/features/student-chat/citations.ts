export const getCitationKey = (messageId: string, citationNumber: number) => `${messageId}-${citationNumber}`;

function normalizeCitationTokens(content: string, maxCitationNumber?: number): string {
  let normalized = content.replace(/<<\s*cite\s*:\s*([1-9]\d*)\s*>>/gi, (_, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (!Number.isFinite(citationNumber) || citationNumber < 1) {
      return '';
    }
    if (maxCitationNumber && citationNumber > maxCitationNumber) {
      return '';
    }
    return `<<cite:${citationNumber}>>`;
  });

  if (!maxCitationNumber || maxCitationNumber < 1) {
    return normalized;
  }

  // Backward compatibility for older messages that used [n] or (n).
  normalized = normalized.replace(/\[([1-9]\d*)\]/g, (match, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (!Number.isFinite(citationNumber) || citationNumber < 1 || citationNumber > maxCitationNumber) {
      return match;
    }
    return `<<cite:${citationNumber}>>`;
  });

  normalized = normalized.replace(/\(([1-9]\d*)\)/g, (match, rawNumber) => {
    const citationNumber = Number(rawNumber);
    if (!Number.isFinite(citationNumber) || citationNumber < 1 || citationNumber > maxCitationNumber) {
      return match;
    }
    return `<<cite:${citationNumber}>>`;
  });

  return normalized;
}

export const markdownWithCitationLinks = (content: string, maxCitationNumber?: number) =>
  normalizeCitationTokens(content, maxCitationNumber).replace(/<<cite:(\d+)>>/g, '[\\[$1\\]](citation:$1)');
