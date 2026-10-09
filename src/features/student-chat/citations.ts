import type { Citation } from './types';

export const getCitationKey = (messageId: string, citationNumber: number) => `${messageId}-${citationNumber}`;

const WEBCAST_TYPES = new Set(['video', 'transcript', 'mp4', 'webm']);

export function isWebcastCitation(c: Citation): boolean {
  return WEBCAST_TYPES.has(c.documentType?.toLowerCase() ?? '');
}

/**
 * Rewrites runs of adjacent <<cite:n>> tokens that together span both
 * Webcast and Notes source families into a composite <<cite:n+m>> token.
 * Single-family runs are left as-is so existing rendering is unaffected.
 */
export function normalizeHeadings(content: string): string {
  return content.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2');
}

export function groupAdjacentCitations(content: string, citations: Citation[]): string {
  return content.replace(/((?:<<cite:\d+>>\s*)+)/g, (run) => {
    const nums = [...run.matchAll(/<<cite:(\d+)>>/g)].map((m) => Number(m[1]));
    if (nums.length < 2) return run;

    const resolved = nums.map((n) => citations[n - 1]).filter(Boolean);
    const anyWebcast = resolved.some(isWebcastCitation);
    const anyNotes = resolved.some((c) => !isWebcastCitation(c));

    if (anyWebcast && anyNotes) {
      return `<<cite:${nums.join('+')}>>`;
    }
    return run;
  });
}

// Canonical <<cite:N>> tokens, one per source: a marker listing several
// sources (<<cite:2,3>>, seen in older answers) becomes adjacent tokens, and
// out-of-range numbers are dropped. Composite <<cite:1+2>> tokens from
// groupAdjacentCitations pass through. Bare [n] / (n) are left as text so
// maths such as $w^{(3)}$ or O(1) is never turned into a citation.
function normalizeCitationTokens(content: string, maxCitationNumber?: number): string {
  return content.replace(/<<\s*cite\s*:\s*([\d\s,]+?)\s*>>/gi, (_, body: string) =>
    body
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && (!maxCitationNumber || n <= maxCitationNumber))
      .map((n) => `<<cite:${n}>>`)
      .join(''),
  );
}

export const markdownWithCitationLinks = (content: string, maxCitationNumber?: number) =>
  normalizeCitationTokens(content, maxCitationNumber).replace(/<<cite:([\d+]+)>>/g, (_, key) => {
    const display = key.replace(/\+/g, '·');
    return `[\\[${display}\\]](citation:${key})`;
  });
