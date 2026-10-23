// Reads the first bytes and the recorded content type of a Storage object, so
// admission can check a file's signature without downloading all of it.
import { SIGNATURE_SEARCH_BYTES } from "./uploadPolicy.ts";

export const STORED_HEAD_BYTES = SIGNATURE_SEARCH_BYTES;

export interface StoredObjectHead {
  // As recorded by Storage when the file was uploaded; null if not reported.
  contentType: string | null;
  head: Uint8Array;
}

export interface ReadStoredObjectHeadOptions {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  path: string;
  fetchImpl?: typeof fetch;
}

function objectUrl(supabaseUrl: string, bucket: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

async function readUpTo(response: Response, limit: number): Promise<Uint8Array> {
  const head = new Uint8Array(limit);
  let length = 0;
  const reader = response.body?.getReader();
  if (!reader) return head.slice(0, 0);
  while (length < limit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const take = Math.min(value.length, limit - length);
    head.set(value.subarray(0, take), length);
    length += take;
  }
  // Stop the transfer if Storage ignored the Range header.
  await reader.cancel().catch(() => undefined);
  return head.slice(0, length);
}

// Returns null when the object does not exist; throws on other failures.
export async function readStoredObjectHead(options: ReadStoredObjectHeadOptions): Promise<StoredObjectHead | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(objectUrl(options.supabaseUrl, options.bucket, options.path), {
    headers: {
      Authorization: `Bearer ${options.serviceKey}`,
      apikey: options.serviceKey,
      Range: `bytes=0-${STORED_HEAD_BYTES - 1}`,
    },
  });
  // Storage answers a missing object with 400 or 404 depending on version.
  if (response.status === 400 || response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Could not read the stored file (${response.status})`);
  }
  return {
    contentType: response.headers.get("Content-Type"),
    head: await readUpTo(response, STORED_HEAD_BYTES),
  };
}
