import type { VideoEvidenceSegment } from './types';

export interface VideoIntervalSource {
  startMs: number;
  endMs?: number;
  evidenceSegments?: VideoEvidenceSegment[] | null;
}

export interface VideoInterval {
  startMs: number;
  endMs?: number;
  exact: boolean;
}

export function getVideoInterval(source: VideoIntervalSource): VideoInterval {
  const evidence = source.evidenceSegments?.length ? source.evidenceSegments : null;
  if (!evidence) {
    return { startMs: source.startMs, endMs: source.endMs, exact: false };
  }

  return {
    startMs: Math.min(...evidence.map((segment) => segment.startMs)),
    endMs: Math.max(...evidence.map((segment) => segment.endMs)),
    exact: true,
  };
}
