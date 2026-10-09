// Text search inside the document reader. Page text comes from the PDF that is
// already loaded in the browser (pdf.js text content); matching is
// case-insensitive and treats runs of whitespace as one space.

export interface SearchMatch {
  page: number;
  // Position of the match in the page's whitespace-normalised text.
  offset: number;
}

const MIN_QUERY_LENGTH = 2;

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').toLowerCase();
}

function usableQuery(query: string): string | null {
  const normalised = normalise(query).trim();
  return normalised.length >= MIN_QUERY_LENGTH ? normalised : null;
}

export function findMatches(pageTexts: string[], query: string): SearchMatch[] {
  const needle = usableQuery(query);
  if (!needle) return [];

  const matches: SearchMatch[] = [];
  pageTexts.forEach((text, index) => {
    const haystack = normalise(text);
    for (let offset = haystack.indexOf(needle); offset !== -1; offset = haystack.indexOf(needle, offset + needle.length)) {
      matches.push({ page: index + 1, offset });
    }
  });
  return matches;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One text-layer run with every match wrapped in <mark>, for react-pdf's
// customTextRenderer. The run is escaped first, so it is never read as HTML.
export function highlightMatches(text: string, query: string): string {
  const needle = usableQuery(query);
  if (!needle) return escapeHtml(text);

  const pattern = new RegExp(escapeRegExp(needle).replace(/ /g, '\\s+'), 'gi');
  let html = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    html += escapeHtml(text.slice(last, start));
    html += `<mark class="pdf-search-hit">${escapeHtml(match[0])}</mark>`;
    last = start + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}
