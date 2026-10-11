export interface VideoEvidenceSegment {
  id: string;
  segmentIndex: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface VideoEvidenceCandidate {
  citation: number;
  materialId: string;
  segments: VideoEvidenceSegment[];
}

export function parseVideoEvidenceSelection(
  raw: string,
  candidates: VideoEvidenceCandidate[],
): Map<number, VideoEvidenceSegment[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!parsed || typeof parsed !== "object" || !("citations" in parsed) || !Array.isArray(parsed.citations)) {
    return new Map();
  }

  const available = new Map(candidates.map((candidate) => [candidate.citation, candidate.segments]));
  const selected = new Map<number, VideoEvidenceSegment[]>();
  for (const entry of parsed.citations) {
    if (!entry || typeof entry !== "object" || !Number.isInteger(entry.citation) ||
      !Array.isArray(entry.segmentIndices) || !available.has(entry.citation)) continue;
    const byIndex = new Map(available.get(entry.citation)!.map((segment) => [segment.segmentIndex, segment]));
    const evidence = [...new Set(entry.segmentIndices)]
      .filter((index): index is number => Number.isInteger(index) && byIndex.has(index))
      .map((index) => byIndex.get(index)!)
      .sort((a, b) => a.startMs - b.startMs);
    if (evidence.length > 0) selected.set(entry.citation, evidence);
  }
  return selected;
}
