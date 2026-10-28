import type { Citation } from './types';

export const getCitationKey = (messageId: string, citationNumber: number) => `${messageId}-${citationNumber}`;

const WEBCAST_TYPES = new Set(['video', 'transcript', 'mp4', 'webm']);

export function isWebcastCitation(c: Citation): boolean {
  return WEBCAST_TYPES.has(c.documentType?.toLowerCase() ?? '');
}

export function normalizeHeadings(content: string): string {
  return content.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2');
}

// Canonical <<cite:N>> tokens, one per source: a marker listing several
// sources (<<cite:2,3>>, seen in older answers) becomes adjacent tokens, and
// out-of-range numbers are dropped. Legacy composite <<cite:1+2>> tokens
// also become adjacent tokens. Bare [n] / (n) are left as text so
// maths such as $w^{(3)}$ or O(1) is never turned into a citation.
function normalizeCitationTokens(content: string, maxCitationNumber?: number): string {
  return content.replace(/<<\s*cite\s*:\s*([\d\s,+]+?)\s*>>/gi, (_, body: string) =>
    body
      .split(/[, +]+/)
      .map((item) => Number(item.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && (!maxCitationNumber || n <= maxCitationNumber))
      .map((n) => `<<cite:${n}>>`)
      .join(''),
  );
}

export const markdownWithCitationLinks = (content: string, maxCitationNumber?: number) =>
  normalizeCitationTokens(content, maxCitationNumber).replace(/<<cite:(\d+)>>/g, (_, number) =>
    `[\\[${number}\\]](citation:${number})`,
  );
