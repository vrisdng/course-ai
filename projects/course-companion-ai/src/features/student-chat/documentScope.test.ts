import { describe, expect, it } from 'vitest';

import {
  getDocumentScopeSummary,
  getDocumentSelectorLabel,
  sanitizeSelectedDocumentIds,
  type ChatDocumentOption,
} from './documentScope';

const documents: ChatDocumentOption[] = [
  { id: 'doc-1', name: 'Lecture 1.pdf', type: 'pdf' },
  { id: 'doc-2', name: 'Tutorial 2.pdf', type: 'pdf' },
  { id: 'doc-3', name: 'Week 3 Notes.docx', type: 'notes' },
];

describe('documentScope helpers', () => {
  it('keeps only valid unique selected document ids', () => {
    expect(sanitizeSelectedDocumentIds(['doc-1', 'doc-2', 'doc-1', 'missing'], documents)).toEqual([
      'doc-1',
      'doc-2',
    ]);
  });

  it('describes the full-course scope when nothing is selected', () => {
    expect(getDocumentScopeSummary(documents, [])).toBe('All course documents');
  });

  it('describes one or more selected documents', () => {
    expect(getDocumentScopeSummary(documents, ['doc-2'])).toBe('Tutorial 2.pdf');
    expect(getDocumentScopeSummary(documents, ['doc-1', 'doc-2'])).toBe('Lecture 1.pdf and Tutorial 2.pdf');
    expect(getDocumentScopeSummary(documents, ['doc-1', 'doc-2', 'doc-3'])).toBe('3 selected documents');
  });

  it('builds selector labels for loading and empty states', () => {
    expect(getDocumentSelectorLabel(documents, [], true)).toBe('Loading documents...');
    expect(getDocumentSelectorLabel([], [], false)).toBe('No processed documents');
  });

  it('uses count-based selector labels for the main chat dropdown', () => {
    expect(getDocumentSelectorLabel(documents, [], false)).toBe('All materials selected');
    expect(getDocumentSelectorLabel(documents, ['doc-2'], false)).toBe('1 material selected');
    expect(getDocumentSelectorLabel(documents, ['doc-1', 'doc-2'], false)).toBe('2 materials selected');
    expect(getDocumentSelectorLabel(documents, ['doc-1', 'doc-2', 'doc-3'], false)).toBe('All materials selected');
  });
});
