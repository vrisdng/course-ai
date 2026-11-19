import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), createSignedUrls: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: mocks.from } },
}));

import {
  MAX_QUESTION_IMAGES,
  acceptImageFiles,
  imageFileError,
  signQuestionImages,
  uploadQuestionImages,
  type PendingImage,
} from './questionImages';

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const pending = (n: number): PendingImage[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, file: file(`${i}.png`, 'image/png'), previewUrl: `blob:${i}` }));

beforeEach(() => {
  mocks.upload.mockReset();
  mocks.createSignedUrls.mockReset();
  mocks.from.mockReset().mockReturnValue({ upload: mocks.upload, createSignedUrls: mocks.createSignedUrls });
});

describe('imageFileError', () => {
  it('accepts PNG, JPEG and WebP up to 5 MB', () => {
    expect(imageFileError(file('a.png', 'image/png'))).toBeNull();
    expect(imageFileError(file('a.jpg', 'image/jpeg'))).toBeNull();
    expect(imageFileError(file('a.webp', 'image/webp'))).toBeNull();
  });

  it('names the file it rejects and why', () => {
    expect(imageFileError(file('notes.pdf', 'application/pdf'))).toBe('notes.pdf isn’t a PNG, JPEG or WebP image.');
    expect(imageFileError(file('big.png', 'image/png', 5 * 1024 * 1024 + 1))).toBe('big.png is over 5 MB.');
  });
});

describe('acceptImageFiles', () => {
  it('adds valid images with previews and reports the rest', () => {
    const createUrl = vi.fn((f: File) => `blob:${f.name}`);
    const result = acceptImageFiles([], [file('a.png', 'image/png'), file('b.gif', 'image/gif')], createUrl);
    expect(result.added).toEqual([{ id: expect.any(String), file: expect.any(File), previewUrl: 'blob:a.png' }]);
    expect(result.errors).toEqual(['b.gif isn’t a PNG, JPEG or WebP image.']);
  });

  it(`stops at ${MAX_QUESTION_IMAGES} images`, () => {
    const result = acceptImageFiles(pending(3), [file('a.png', 'image/png'), file('b.png', 'image/png')], () => 'blob:x');
    expect(result.added).toHaveLength(1);
    expect(result.errors).toEqual([`You can attach up to ${MAX_QUESTION_IMAGES} images.`]);
  });
});

describe('uploadQuestionImages', () => {
  it('uploads each image into the student’s own folder', async () => {
    mocks.upload.mockResolvedValue({ data: {}, error: null });
    const images: PendingImage[] = [
      { id: 'a', file: file('a.png', 'image/png'), previewUrl: '' },
      { id: 'b', file: file('b.jpg', 'image/jpeg'), previewUrl: '' },
    ];
    const paths = await uploadQuestionImages('user-1', images);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(/^user-1\/[0-9a-f-]{36}\.png$/);
    expect(paths[1]).toMatch(/^user-1\/[0-9a-f-]{36}\.jpg$/);
    expect(mocks.from).toHaveBeenCalledWith('question-images');
    expect(mocks.upload).toHaveBeenCalledWith(paths[1], images[1].file, { contentType: 'image/jpeg', upsert: false });
  });

  it('fails the send when an upload fails', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: { message: 'quota' } });
    await expect(uploadQuestionImages('user-1', pending(1))).rejects.toThrow('Couldn’t upload 0.png: quota');
  });
});

describe('signQuestionImages', () => {
  it('returns a short-lived link per path, skipping ones that failed', async () => {
    mocks.createSignedUrls.mockResolvedValue({
      data: [{ path: 'u/a.png', signedUrl: 'https://s/a' }, { path: 'u/b.png', signedUrl: null, error: 'nope' }],
      error: null,
    });
    await expect(signQuestionImages(['u/a.png', 'u/b.png'])).resolves.toEqual({ 'u/a.png': 'https://s/a' });
    expect(mocks.createSignedUrls).toHaveBeenCalledWith(['u/a.png', 'u/b.png'], 3600);
  });

  it('asks for nothing when there are no images', async () => {
    await expect(signQuestionImages([])).resolves.toEqual({});
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
