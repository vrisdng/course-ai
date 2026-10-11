// Cloudflare R2 size policy for video storage.
//
// There is no application-specific video size ceiling. Any file R2 can accept is
// accepted, subject only to R2's current multipart/object limits (see
// docs/scratchpad/cloudflare-r2-video-migration-plan.md "Upload Size Policy"):
// a 5 TB maximum object, at most 10,000 parts, a 5 MiB minimum non-final part,
// and a 5 GiB maximum part size. Files that cannot fit within those limits are
// rejected up front with a specific error, before any bytes transfer.

export const R2_MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024 * 1024; // 5 TB maximum object
export const R2_MAX_PART_COUNT = 10_000; // maximum parts per multipart upload
export const R2_MIN_PART_BYTES = 5 * 1024 * 1024; // 5 MiB minimum non-final part
export const R2_DEFAULT_PART_BYTES = 64 * 1024 * 1024; // starting uniform part size
export const R2_MAX_PART_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB maximum part size

const ceilDiv = (dividend: number, divisor: number): number => Math.ceil(dividend / divisor);

/**
 * Adaptive uniform part size for a video of `totalBytes`. Files small enough to
 * fit in 10,000 default parts use 64 MiB parts; larger files grow the part size
 * so the transfer never exceeds R2's 10,000-part limit. The result is always
 * between the default floor and R2's 5 GiB maximum.
 */
export function adaptiveVideoPartSize(totalBytes: number): number {
  const requiredToStayUnderPartLimit = totalBytes > 0 ? ceilDiv(totalBytes, R2_MAX_PART_COUNT) : R2_DEFAULT_PART_BYTES;
  return Math.min(R2_MAX_PART_BYTES, Math.max(R2_DEFAULT_PART_BYTES, requiredToStayUnderPartLimit));
}

/**
 * Returns a specific error message when a file cannot fit within R2's current
 * multipart/object limits, otherwise null. Never imposes a product ceiling.
 */
export function validateVideoSizeBytes(totalBytes: number): string | null {
  if (!Number.isFinite(totalBytes) || totalBytes < 1) {
    return 'Video files cannot be empty or have an invalid size.';
  }
  if (totalBytes > R2_MAX_OBJECT_BYTES) {
    return `Video files must be ${formatByteSizeLimit(R2_MAX_OBJECT_BYTES)} or smaller.`;
  }
  return null;
}

function formatByteSizeLimit(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = Number.isInteger(value) ? `${value}` : `${value.toFixed(1)}`;
  return `${formatted} ${units[unit]}`;
}
