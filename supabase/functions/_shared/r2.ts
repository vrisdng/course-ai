// Cloudflare R2 (S3-compatible) video storage primitives shared by the
// upload-session and transcription workers. Bucket-scoped credentials are
// chosen per environment (CLOUDFLARE_R2_ENV = dev|prod, default dev). The
// browser is given short-lived credentials restricted to one object so it can
// upload parts directly to private R2. Nothing here logs credentials or URLs.

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
} from "https://esm.sh/@aws-sdk/client-s3@3.1147.0";

export const R2_DEFAULT_PART_SIZE = 64 * 1024 * 1024; // 64 MiB starting part size
export const R2_MAX_PART_COUNT = 10_000;
export const R2_MAX_PART_SIZE = 5 * 1024 * 1024 * 1024;
export const R2_UPLOAD_STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const R2_UPLOAD_CREDENTIAL_TTL_SECONDS = 60 * 60; // 1h; refresh resumes the same upload
export const R2_GET_URL_TTL_SECONDS = 6 * 60 * 60; // 6h AssemblyAI fetch budget

export type R2Env = "dev" | "prod";
export interface R2Connection { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; }
export interface R2Part { partNumber: number; etag: string; size: number; }
export interface R2MultipartUpload { objectKey: string; r2UploadId: string; partSize: number; expiresAt: string; }

export function selectR2Env(): R2Env {
  const env = (Deno.env.get("CLOUDFLARE_R2_ENV") ?? "dev").toLowerCase();
  return env === "prod" ? "prod" : "dev";
}

export function r2Connection(env: R2Env): R2Connection {
  const suffix = env === "prod" ? "PROD" : "DEV";
  const bucket = Deno.env.get(`CLOUDFLARE_BUCKET_VIDEO_NAME_${suffix}`);
  const endpoint = Deno.env.get("CLOUDFLARE_S3_API_ENDPOINT");
  const accessKeyId = Deno.env.get(`CLOUDFLARE_ACCESS_KEY_ID_${suffix}`);
  const secretAccessKey = Deno.env.get(`CLOUDFLARE_SECRET_ACCESS_KEY_${suffix}`);
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 video storage is not configured");
  }
  return { endpoint, region: "auto", bucket, accessKeyId, secretAccessKey };
}

export function r2S3Client(env: R2Env = selectR2Env()): S3Client {
  const connection = r2Connection(env);
  return new S3Client({
    endpoint: connection.endpoint,
    region: connection.region,
    forcePathStyle: true,
    credentials: { accessKeyId: connection.accessKeyId, secretAccessKey: connection.secretAccessKey },
  });
}

export async function r2IssueCredentials(
  objectKey: string,
  _allowedActions: readonly string[],
  env: R2Env = selectR2Env(),
): Promise<Record<string, string>> {
  const connection = r2Connection(env);
  const suffix = env === "prod" ? "PROD" : "DEV";
  const apiToken = Deno.env.get(`CLOUDFLARE_API_KEY_${suffix}`);
  if (!apiToken) throw new Error("R2 temporary credential issuance is not configured");
  const accountId = new URL(connection.endpoint).hostname.split(".")[0];
  // ponytail: Cloudflare's API supports exact-object scope but not action scope;
  // pass actions once their Temporary Credentials API accepts that field.
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/temp-access-credentials`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket: connection.bucket,
      parentAccessKeyId: connection.accessKeyId,
      permission: "object-read-write",
      ttlSeconds: R2_UPLOAD_CREDENTIAL_TTL_SECONDS,
      objects: [objectKey],
    }),
  });
  const payload = await response.json() as {
    success?: boolean;
    result?: { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string };
  };
  const credentials = payload.result;
  if (!response.ok || !payload.success || !credentials?.accessKeyId ||
    !credentials.secretAccessKey || !credentials.sessionToken) {
    throw new Error("Cloudflare did not issue temporary R2 credentials");
  }
  return {
    endpoint: connection.endpoint,
    region: connection.region,
    bucket: connection.bucket,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    expiresAt: new Date(Date.now() + R2_UPLOAD_CREDENTIAL_TTL_SECONDS * 1000).toISOString(),
  };
}

export function adaptiveR2PartSize(fileSize: number): number {
  return Math.min(
    R2_MAX_PART_SIZE,
    Math.max(R2_DEFAULT_PART_SIZE, Math.ceil(fileSize / R2_MAX_PART_COUNT)),
  );
}

export async function r2CreateMultipartUpload(
  filePath: string,
  contentType: string,
  fileSize: number,
): Promise<R2MultipartUpload> {
  const env = selectR2Env();
  const { bucket } = r2Connection(env);
  const { UploadId } = await r2S3Client(env).send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: filePath,
    ContentType: contentType,
  }));
  if (!UploadId) throw new Error("R2 returned no multipart upload id");
  return {
    objectKey: filePath,
    r2UploadId: UploadId,
    partSize: adaptiveR2PartSize(fileSize),
    expiresAt: new Date(Date.now() + R2_UPLOAD_STATE_TTL_MS).toISOString(),
  };
}

export async function r2ListParts(objectKey: string, r2UploadId: string): Promise<R2Part[]> {
  const env = selectR2Env();
  const { bucket } = r2Connection(env);
  const client = r2S3Client(env);
  const parts: R2Part[] = [];
  let partNumberMarker: string | undefined;
  do {
    const response = await client.send(new ListPartsCommand({
      Bucket: bucket,
      Key: objectKey,
      UploadId: r2UploadId,
      PartNumberMarker: partNumberMarker,
    }));
    for (const part of response.Parts ?? []) {
      if (part.PartNumber != null && part.ETag && part.Size != null) {
        parts.push({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size });
      }
    }
    partNumberMarker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
    if (response.IsTruncated && !partNumberMarker) throw new Error("R2 returned a truncated part list without a marker");
  } while (partNumberMarker);
  return parts;
}

export async function r2CompleteMultipartUpload(objectKey: string, r2UploadId: string, parts: R2Part[]): Promise<{ size: number; contentType: string }> {
  const env = selectR2Env();
  const { bucket } = r2Connection(env);
  const client = r2S3Client(env);
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: objectKey,
    UploadId: r2UploadId,
    MultipartUpload: { Parts: parts.slice().sort((a, b) => a.partNumber - b.partNumber).map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
  }));
  // R2 verifies the per-part checksums, but still confirm the result so we never
  // trust a finished upload blindly: a zero-byte object is abandoned upstream.
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  const size = head.ContentLength ?? 0;
  if (size === 0) throw new Error("R2 reported a zero-byte object");
  return { size, contentType: head.ContentType ?? "" };
}

export async function r2AbortMultipartUpload(objectKey: string, r2UploadId: string): Promise<void> {
  const env = selectR2Env();
  const { bucket } = r2Connection(env);
  try {
    await r2S3Client(env).send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: objectKey, UploadId: r2UploadId }));
  } catch (error) {
    if ((error as { name?: string }).name !== "NoSuchUpload") throw error;
  }
}

export async function r2DeleteObject(objectKey: string): Promise<void> {
  const env = selectR2Env();
  const { bucket } = r2Connection(env);
  await r2S3Client(env).send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}

// Metadata (size, content-type) for a stored object — used to confirm a video
// is complete and matches the recorded size before transcription fetches it.
export async function r2HeadObject(key: string): Promise<{ contentType: string; contentLength: number }> {
  const env = selectR2Env();
  const { bucket } = r2Connection(env);
  const head = await r2S3Client(env).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return { contentType: head.ContentType ?? "", contentLength: head.ContentLength ?? 0 };
}

// SigV4 query-signing helpers using the Web Crypto API, which is available in
// both the Deno Edge runtime and Node without additional dependencies.
const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(digest);
}

async function hmacSha256(key: string | Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const keyBytes = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const dataBytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const secret = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await globalThis.crypto.subtle.sign("HMAC", secret, dataBytes);
  return new Uint8Array(mac);
}

// Short-lived GET URL for playback or a provider (AssemblyAI) to fetch the object.
// Only the host header is signed; R2 accepts the resulting SigV4 query-auth URL
// so the browser never receives R2 credentials or a dashboard link. The S3 SDK in
// this version exposes no presigning primitive, so this signs the request directly.
export async function r2GetSignedGetUrl(key: string, ttlSeconds: number = R2_GET_URL_TTL_SECONDS): Promise<string> {
  const env = selectR2Env();
  const connection = r2Connection(env);
  const host = new URL(connection.endpoint).host; // e.g. <account>.r2.cloudflarestorage.com
  const uri = `/${connection.bucket}/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${connection.region}/s3/aws4_request`;
  const credential = `${connection.accessKeyId}/${scope}`;
  const canonicalQuery = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(credential)}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${ttlSeconds}`,
    `X-Amz-SignedHeaders=host`,
  ].join("&");
  const canonicalRequest =
    "GET\n" +
    uri + "\n" +
    canonicalQuery + "\n" +
    `host:${host}\n` +
    "\n" +
    "host\n" +
    "UNSIGNED-PAYLOAD";
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const kDate = await hmacSha256(`AWS4${connection.secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, connection.region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  return `https://${host}${uri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
