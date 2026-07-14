import { describe, expect, it } from 'vitest';

import {
  INLINE_GEMINI_MAX_FILE_SIZE_BYTES,
  VIDEO_MAX_FILE_SIZE_BYTES,
  TEXT_INGEST_MAX_CHARACTERS,
  getDeferredUploadValidationError,
  getImmediateUploadValidationError,
  isVideoUpload,
  isTextLikeUpload,
  usesInlineGeminiExtraction,
} from './materialUpload';

describe('material upload policy', () => {
  it('applies the 15MB immediate limit only to inline Gemini formats', () => {
    const pdfCandidate = {
      name: 'lecture.pdf',
      size: INLINE_GEMINI_MAX_FILE_SIZE_BYTES + 1,
    };
    const docxCandidate = {
      name: 'slides.docx',
      size: INLINE_GEMINI_MAX_FILE_SIZE_BYTES + 1,
    };

    expect(usesInlineGeminiExtraction(pdfCandidate)).toBe(true);
    expect(usesInlineGeminiExtraction(docxCandidate)).toBe(false);
    expect(getImmediateUploadValidationError(pdfCandidate)).toContain('15MB');
    expect(getImmediateUploadValidationError(docxCandidate)).toBeNull();
  });

  it('applies the 5GB immediate limit to supported video uploads', () => {
    const videoCandidate = {
      name: 'lecture.mp4',
      size: VIDEO_MAX_FILE_SIZE_BYTES + 1,
    };

    expect(isVideoUpload(videoCandidate)).toBe(true);
    expect(getImmediateUploadValidationError(videoCandidate)).toContain('5GB');
  });

  it('treats code and text uploads as text-like content', () => {
    expect(isTextLikeUpload({ name: 'notes.txt', type: 'text/plain' })).toBe(true);
    expect(isTextLikeUpload({ name: 'widget.ts', type: '' })).toBe(true);
    expect(isTextLikeUpload({ name: 'deck.pptx', type: '' })).toBe(false);
  });

  it('enforces the character limit for text-like files', async () => {
    const oversizedTextFile = {
      name: 'notes.txt',
      type: 'text/plain',
      size: TEXT_INGEST_MAX_CHARACTERS + 1,
      text: async () => 'a'.repeat(TEXT_INGEST_MAX_CHARACTERS + 1),
    } as File;

    await expect(getDeferredUploadValidationError(oversizedTextFile)).resolves.toContain('500,000');
  });
});
