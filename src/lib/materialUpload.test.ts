import { describe, expect, it } from 'vitest';

import {
  INLINE_GEMINI_MAX_FILE_SIZE_BYTES,
  VIDEO_MAX_FILE_SIZE_BYTES,
  TEXT_INGEST_MAX_CHARACTERS,
  getDeferredUploadValidationError,
  getImmediateUploadValidationError,
  findFirstInvalidKeyChar,
  formatInvalidKeyMessage,
  getInvalidUploadKeyError,
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

describe('getInvalidUploadKeyError', () => {
  it('rejects the leading tilde from the reported upload', () => {
    const error = getInvalidUploadKeyError({ name: '~CE5010QB Ch1 Slides.pdf' });
    expect(error).toContain('~');
    expect(error).toContain('not allowed');
  });

  it('rejects backslashes, pipes and non-ASCII that the backend storage engine forbids', () => {
    expect(getInvalidUploadKeyError({ name: 'folder\\file.pdf' })).not.toBeNull();
    expect(getInvalidUploadKeyError({ name: 'a|b.pdf' })).not.toBeNull();
    expect(getInvalidUploadKeyError({ name: 'café.pdf' })).not.toBeNull();
  });

  it('surfaces the exact offending character in the message', () => {
    const error = getInvalidUploadKeyError({ name: 'notes (café).pdf' });
    expect(error).toContain('é');
    expect(error).toContain('not allowed');
  });

  it('findFirstInvalidKeyChar returns the first bad char and null for valid names', () => {
    expect(findFirstInvalidKeyChar('~CE5010QB Ch1 Slides.pdf')).toBe('~');
    expect(findFirstInvalidKeyChar('Lecture 1 - Intro.pdf')).toBeNull();
    expect(formatInvalidKeyMessage('a~b.pdf', '~')).toContain('contains the character "~"');
  });

  it('allows names with letters, digits, spaces and safe punctuation', () => {
    expect(getInvalidUploadKeyError({ name: '~CE5010QB Ch1 Slides.pdf' })).not.toBeNull();
    expect(getInvalidUploadKeyError({ name: 'Lecture 1 - Intro.pdf' })).toBeNull();
    expect(getInvalidUploadKeyError({ name: 'course/materials/deck.pptx' })).toBeNull();
    expect(getInvalidUploadKeyError({ name: 'notes_(final).docx' })).toBeNull();
  });
});
