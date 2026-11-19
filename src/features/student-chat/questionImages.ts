// Images a student attaches to a chat question: checks before upload, the
// upload into the private question-images bucket, and short-lived links for
// showing them again. Limits are shared with rag-chat.
import { supabase } from '@/integrations/supabase/client';

import {
  MAX_QUESTION_IMAGE_BYTES,
  MAX_QUESTION_IMAGES,
  QUESTION_IMAGE_BUCKET,
} from '../../../supabase/functions/_shared/questionImages.ts';

import type { MessageImage } from './types';

export { MAX_QUESTION_IMAGES, QUESTION_IMAGE_BUCKET };

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
export const ACCEPTED_IMAGE_TYPES = Object.keys(EXTENSION_BY_TYPE);
// Long enough to read a conversation; links are re-made on each load.
const SIGNED_URL_SECONDS = 3600;

// An image picked or pasted but not sent yet.
export interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

export function imageFileError(file: File): string | null {
  if (!EXTENSION_BY_TYPE[file.type]) return `${file.name} isn’t a PNG, JPEG or WebP image.`;
  if (file.size > MAX_QUESTION_IMAGE_BYTES) return `${file.name} is over 5 MB.`;
  return null;
}

export function acceptImageFiles(
  current: PendingImage[],
  files: File[],
  createUrl: (file: File) => string = (file) => URL.createObjectURL(file),
): { added: PendingImage[]; errors: string[] } {
  const added: PendingImage[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const error = imageFileError(file);
    if (error) {
      errors.push(error);
      continue;
    }
    if (current.length + added.length >= MAX_QUESTION_IMAGES) {
      errors.push(`You can attach up to ${MAX_QUESTION_IMAGES} images.`);
      break;
    }
    added.push({ id: crypto.randomUUID(), file, previewUrl: createUrl(file) });
  }
  return { added, errors };
}

// Uploads into "<user id>/<uuid>.<ext>", the only shape rag-chat accepts.
export async function uploadQuestionImages(userId: string, images: PendingImage[]): Promise<string[]> {
  const bucket = supabase.storage.from(QUESTION_IMAGE_BUCKET);
  return await Promise.all(images.map(async (image) => {
    const path = `${userId}/${crypto.randomUUID()}.${EXTENSION_BY_TYPE[image.file.type]}`;
    const { error } = await bucket.upload(path, image.file, { contentType: image.file.type, upsert: false });
    if (error) throw new Error(`Couldn’t upload ${image.file.name}: ${error.message}`);
    return path;
  }));
}

// Path → signed URL; paths that couldn't be signed are left out.
export async function signQuestionImages(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(QUESTION_IMAGE_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error) {
    console.error('Failed to sign question images:', error);
    return {};
  }
  const urls: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return urls;
}

// The images on each of these questions, in the order they were attached.
export async function loadMessageImages(messageIds: string[]): Promise<Record<string, MessageImage[]>> {
  if (messageIds.length === 0) return {};
  const { data, error } = await supabase
    .from('message_attachments')
    .select('message_id, storage_path, position')
    .in('message_id', messageIds);
  if (error) {
    console.error('Failed to load question images:', error);
    return {};
  }
  const rows = [...(data ?? [])].sort((a, b) => a.position - b.position);
  const urls = await signQuestionImages(rows.map((row) => row.storage_path));
  const byMessage: Record<string, MessageImage[]> = {};
  for (const row of rows) {
    const url = urls[row.storage_path];
    if (!url) continue;
    (byMessage[row.message_id] ??= []).push({ url });
  }
  return byMessage;
}
