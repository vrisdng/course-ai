import { describe, expect, it } from 'vitest';

import {
  INLINE_GEMINI_MAX_FILE_SIZE_BYTES,
  VIDEO_MAX_FILE_SIZE_BYTES,
  TEXT_INGEST_MAX_CHARACTERS,
  getDeferredUploadValidationError,
  getImmediateUploadValidationError,
  isStorageSafeKey,
  toStorageSafeFileName,
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

describe('toStorageSafeFileName', () => {
  it('strips the leading tilde from the reported upload and keeps the rest intact', () => {
    expect(toStorageSafeFileName('~CE5010QB Ch1 Slides.pdf')).toBe('CE5010QB Ch1 Slides.pdf');
  });

  it('leaves names that only use allowed characters unchanged', () => {
    expect(toStorageSafeFileName('Lecture 1 - Intro.pdf')).toBe('Lecture 1 - Intro.pdf');
    expect(toStorageSafeFileName('notes_(final).docx')).toBe('notes_(final).docx');
    expect(toStorageSafeFileName("q&a's + more!.pptx")).toBe("q&a's + more!.pptx");
  });

  it('transliterates accented letters instead of replacing them', () => {
    expect(toStorageSafeFileName('café.pdf')).toBe('cafe.pdf');
    expect(toStorageSafeFileName('Übung résumé.docx')).toBe('Ubung resume.docx');
  });

  it('replaces other disallowed characters with underscores and collapses runs', () => {
    expect(toStorageSafeFileName('a|b\\c#d.pdf')).toBe('a_b_c_d.pdf');
    expect(toStorageSafeFileName('slides[v2]{draft}.pptx')).toBe('slides_v2_draft.pptx');
    expect(toStorageSafeFileName('week 1 ~~~ recap.pdf')).toBe('week 1 _ recap.pdf');
  });

  it('does not let a filename create nested storage folders', () => {
    expect(toStorageSafeFileName('folder/file.pdf')).toBe('folder_file.pdf');
  });

  it('preserves the extension so downstream parsers still detect the type', () => {
    expect(toStorageSafeFileName('日本語.pdf')).toBe('file.pdf');
    expect(toStorageSafeFileName('🙂.png')).toBe('file.png');
    expect(toStorageSafeFileName('.env')).toBe('file.env');
  });

  it('handles names without an extension and trims trailing dots and spaces', () => {
    expect(toStorageSafeFileName('README')).toBe('README');
    expect(toStorageSafeFileName('notes. .pdf')).toBe('notes.pdf');
    expect(toStorageSafeFileName('')).toBe('file');
  });

  it('caps very long names', () => {
    const result = toStorageSafeFileName(`${'a'.repeat(400)}.pdf`);
    expect(result.length).toBeLessThanOrEqual(204);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('always produces a key the storage engine accepts', () => {
    const samples = ['~x.pdf', 'café.pdf', 'a|b.pdf', '日本語.pdf', '🙂.png', 'q&a.pdf', 'C++.pdf', '.env', 'README'];
    for (const sample of samples) {
      expect(isStorageSafeKey(toStorageSafeFileName(sample))).toBe(true);
    }
    expect(isStorageSafeKey('~x.pdf')).toBe(false);
    expect(isStorageSafeKey('')).toBe(false);
  });
});
