import { supabase } from '@/integrations/supabase/client';

/**
 * Upload a file to Supabase Storage with real byte-level progress via XMLHttpRequest.
 * Falls back to the standard SDK upload if progress isn't needed.
 */
export async function uploadToStorageWithProgress(opts: {
  bucket: string;
  path: string;
  body: Blob | File;
  contentType?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { bucket, path, body, contentType, onProgress, signal } = opts;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    if (contentType) {
      xhr.setRequestHeader('Content-Type', contentType);
    }
    // Supabase storage expects x-upsert header for upsert behavior; omit for no-upsert
    xhr.setRequestHeader('x-upsert', 'false');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.message) message = body.message;
          if (body?.error) message = body.error;
        } catch {}
        reject(new Error(message));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    if (signal) {
      if (signal.aborted) {
        reject(new Error('Upload cancelled'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(body);
  });
}
