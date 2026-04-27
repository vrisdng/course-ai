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
  normalizeCitationTokens(content, maxCitationNumber).replace(/<<cite:([\d+]+)>>/g, (_, key) => {
    const display = key.replace(/\+/g, '·');
    return `[\\[${display}\\]](citation:${key})`;
  });
