import { describe, expect, it } from 'vitest';

import {
  R2_DEFAULT_PART_BYTES,
  R2_MAX_OBJECT_BYTES,
  R2_MAX_PART_BYTES,
  R2_MAX_PART_COUNT,
  adaptiveVideoPartSize,
  validateVideoSizeBytes,
} from './videoUploadLimits';

describe('adaptiveVideoPartSize', () => {
  it('uses the default part size for files that easily fit in 10,000 parts', () => {
    expect(adaptiveVideoPartSize(0)).toBe(R2_DEFAULT_PART_BYTES);
    expect(adaptiveVideoPartSize(10)).toBe(R2_DEFAULT_PART_BYTES);
    expect(adaptiveVideoPartSize(100 * 1024 * 1024 * 1024)).toBe(R2_DEFAULT_PART_BYTES);
  });

  it('grows for large files so the transfer stays within 10,000 parts', () => {
    const total = 4 * 1024 * 1024 * 1024 * 1024;
    const part = adaptiveVideoPartSize(total);
    expect(part).toBeGreaterThan(R2_DEFAULT_PART_BYTES);
    expect(Math.ceil(total / part)).toBeLessThanOrEqual(R2_MAX_PART_COUNT);
    expect(part).toBeLessThanOrEqual(R2_MAX_PART_BYTES);
  });

  it('never exceeds the R2 maximum part size', () => {
    expect(adaptiveVideoPartSize(60 * 1024 * 1024 * 1024 * 1024)).toBe(R2_MAX_PART_BYTES);
  });
});

describe('validateVideoSizeBytes', () => {
  it('accepts anything that fits within R2 object and part limits', () => {
    expect(validateVideoSizeBytes(1)).toBeNull();
    expect(validateVideoSizeBytes(1_000_000_000)).toBeNull();
    expect(validateVideoSizeBytes(R2_MAX_OBJECT_BYTES)).toBeNull();
  });

  it('rejects empty or non-finite sizes', () => {
    expect(validateVideoSizeBytes(0)).not.toBeNull();
    expect(validateVideoSizeBytes(-1)).not.toBeNull();
    expect(validateVideoSizeBytes(Number.NaN)).not.toBeNull();
    expect(validateVideoSizeBytes(Number.POSITIVE_INFINITY)).not.toBeNull();
  });

  it('rejects a file larger than R2 maximum object size with a specific error', () => {
    expect(validateVideoSizeBytes(R2_MAX_OBJECT_BYTES + 1)).toContain('5 TB');
  });
});
