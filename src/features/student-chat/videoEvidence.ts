import type { VideoEvidenceSegment } from './types';

export function parseVideoEvidenceSegments(value: unknown): VideoEvidenceSegment[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const valid = value.every((segment) =>
    segment && typeof segment === 'object' &&
    typeof segment.id === 'string' &&
    Number.isInteger(segment.segmentIndex) &&
    Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    segment.endMs >= segment.startMs &&
    typeof segment.text === 'string'
  );
  return valid ? value as VideoEvidenceSegment[] : null;
}
