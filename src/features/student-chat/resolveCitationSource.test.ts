import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: unknown[]) => mocks.from(...args) },
}));

import { resolveCitationSource } from './useStudentChat';
import type { Citation } from './types';

// Build a chainable supabase query builder whose awaited value resolves to
// `result`, mirroring the shape Supabase query chains return.
function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const citation = (overrides: Partial<Citation>): Citation => ({
  id: 'c1',
  chunkId: 'chunk-1',
  excerpt: 'x',
  documentName: 'doc',
  documentType: 'pdf',
  relevanceScore: 0.9,
  ...overrides,
});

describe('resolveCitationSource', () => {
  it('resolves a course-materials PDF to its signed preview path', async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: { material_id: 'mat-1', student_document_id: null }, error: null }))
      .mockReturnValueOnce(query({ data: { file_path: 'course-materials/notes.pdf', file_type: 'pdf', file_name: 'Notes', linked_url: null }, error: null }));

    const resolved = await resolveCitationSource(citation({ chunkId: 'chunk-1' }));

    expect(resolved).toEqual({
      bucket: 'course-materials',
      filePath: 'course-materials/notes.pdf',
      fileType: 'pdf',
      fileName: 'Notes',
      materialId: 'mat-1',
      linkedUrl: null,
      thumbnailPaths: null,
    });
  });

  it('resolves a student document to the student-documents bucket', async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: { material_id: null, student_document_id: 'sd-1' }, error: null }))
      .mockReturnValueOnce(query({ data: { file_path: 'student-documents/essay.pdf', file_type: 'pdf', file_name: 'Essay' }, error: null }));

    const resolved = await resolveCitationSource(citation({ chunkId: 'chunk-1' }));

    expect(resolved.bucket).toBe('student-documents');
    expect(resolved.filePath).toBe('student-documents/essay.pdf');
    expect(resolved.materialId).toBeNull();
  });

  it('returns an empty file path for a video with no stored file', async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: { material_id: 'mat-2', student_document_id: null }, error: null }))
      .mockReturnValueOnce(query({ data: { file_path: null, file_type: 'video', file_name: 'Lecture', linked_url: 'https://v.test/1' }, error: null }));

    const resolved = await resolveCitationSource(citation({ chunkId: 'chunk-1' }));

    expect(resolved.fileType).toBe('video');
    expect(resolved.filePath).toBe('');
    expect(resolved.linkedUrl).toBe('https://v.test/1');
  });

  it('throws when the chunk cannot be located', async () => {
    mocks.from.mockReturnValueOnce(query({ data: null, error: { message: 'no chunk' } }));

    await expect(resolveCitationSource(citation({ chunkId: 'missing' }))).rejects.toThrow('no chunk');
  });

  it('throws for a non-video course material without a file path', async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: { material_id: 'mat-3', student_document_id: null }, error: null }))
      .mockReturnValueOnce(query({ data: { file_path: null, file_type: 'pdf', file_name: 'Broken' }, error: null }));

    await expect(resolveCitationSource(citation({ chunkId: 'chunk-1' }))).rejects.toThrow('Unable to locate source file');
  });

  it('throws when the citation has no linked document', async () => {
    mocks.from.mockReturnValueOnce(query({ data: { material_id: null, student_document_id: null }, error: null }));

    await expect(resolveCitationSource(citation({ chunkId: 'chunk-1' }))).rejects.toThrow('Citation source has no linked document');
  });
});
