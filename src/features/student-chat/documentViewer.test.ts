import { describe, expect, it } from 'vitest';

import type { Citation } from './types';
import { classifyCitation, ensureStartingPage, isImageDocumentType } from './documentViewer';

const citation = (overrides: Partial<Citation>): Citation => ({
  id: 'citation-1',
  chunkId: 'chunk-1',
  excerpt: 'Excerpt',
  documentName: 'Source',
  documentType: 'document',
  relevanceScore: 0.9,
  ...overrides,
});

describe('classifyCitation', () => {
  it('opens PDFs in the pdf viewer', () => {
    expect(classifyCitation(citation({ documentType: 'pdf' }))).toBe('pdf');
  });

  it('treats image extensions case-insensitively as images', () => {
    for (const type of ['png', 'JPG', 'jpeg', 'webp', 'GIF']) {
      expect(classifyCitation(citation({ documentType: type }))).toBe('image');
    }
  });

  it('opens videos in the video viewer', () => {
    expect(classifyCitation(citation({ documentType: 'video' }))).toBe('video');
  });

  it('falls back to other for transcript/document/unknown/missing', () => {
    for (const type of ['transcript', 'document', 'docx', '']) {
      expect(classifyCitation(citation({ documentType: type }))).toBe('other');
    }
    expect(classifyCitation(citation({ documentType: undefined }))).toBe('other');
  });
});

describe('image type + page defaults', () => {
  it('recognizes only the configured extensions', () => {
    expect(isImageDocumentType('pdf')).toBe(false);
    expect(isImageDocumentType(undefined)).toBe(false);
    expect(isImageDocumentType('txt')).toBe(false);
    expect(isImageDocumentType('jpg')).toBe(true);
  });

  it('defaults null/invalid page numbers to 1', () => {
    expect(ensureStartingPage(null)).toBe(1);
    expect(ensureStartingPage(undefined)).toBe(1);
    expect(ensureStartingPage(0)).toBe(1);
    expect(ensureStartingPage(-3)).toBe(1);
    expect(ensureStartingPage(7)).toBe(7);
  });
});
