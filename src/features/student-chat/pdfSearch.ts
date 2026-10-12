// Text search inside the document reader. Page text comes from the PDF that is
// already loaded in the browser (pdf.js text content, one string per text-layer
// item). Matching is per item, case-insensitive, and treats runs of whitespace
// as one space, so every match found can also be highlighted in the text layer.

export interface SearchMatch {
  page: number;
  // Index of the text-layer item on the page.
  item: number;
  // Which match within that item (0 = first).
  occurrence: number;
}

const MIN_QUERY_LENGTH = 2;

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').toLowerCase();
}

function usableQuery(query: string): string | null {
  const normalised = normalise(query).trim();
  return normalised.length >= MIN_QUERY_LENGTH ? normalised : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcher(needle: string): RegExp {
  return new RegExp(escapeRegExp(needle).replace(/ /g, '\\s+'), 'gi');
}

export function findMatches(pages: string[][], query: string): SearchMatch[] {
  const needle = usableQuery(query);
  if (!needle) return [];

  const pattern = matcher(needle);
  const matches: SearchMatch[] = [];
  pages.forEach((items, pageIndex) => {
    items.forEach((text, item) => {
      let occurrence = 0;
      for (const _ of text.matchAll(pattern)) {
        matches.push({ page: pageIndex + 1, item, occurrence });
        occurrence += 1;
      }
    });
  });
  return matches;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// One text-layer item with every match wrapped in <mark>, for react-pdf's
// customTextRenderer. The active occurrence (if it is in this item) gets an
// extra class. The text is escaped first, so it is never read as HTML.
export function highlightMatches(text: string, query: string, activeOccurrence: number | null): string {
  const needle = usableQuery(query);
  if (!needle) return escapeHtml(text);

  let html = '';
  let last = 0;
  let occurrence = 0;
  for (const match of text.matchAll(matcher(needle))) {
    const start = match.index ?? 0;
    const className = occurrence === activeOccurrence ? 'pdf-search-hit pdf-search-hit--active' : 'pdf-search-hit';
    html += escapeHtml(text.slice(last, start));
    html += `<mark class="${className}">${escapeHtml(match[0])}</mark>`;
    last = start + match[0].length;
    occurrence += 1;
  }
  return html + escapeHtml(text.slice(last));
}
