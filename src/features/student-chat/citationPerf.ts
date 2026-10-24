import { invalidateSignedMediaCache } from './signedMedia';

export type CitationPerfKind = 'video' | 'pdf' | 'image' | 'other';

export type CitationPerfStep =
  | 'source_resolved'
  | 'panel_state'
  | 'placeholder_visible'
  | 'transcript_painted'
  | 'dialog_open';

export interface CitationPerfSample {
  id: string;
  kind: CitationPerfKind;
  startedAt: number;
  steps: Partial<Record<CitationPerfStep, number>>;
  durations: {
    openToSourceMs: number | null;
    openToPanelMs: number | null;
    openToTranscriptMs: number | null;
  };
  transcriptSource: 'evidence' | 'window' | 'empty' | null;
  mediaRequests3s: number;
  mediaBytes3s: number;
  signedMediaRequests3s: number;
  signedMediaMs: number | null;
  outcome: 'success' | 'error';
}

interface CitationPerfSession {
  id: string;
  kind: CitationPerfKind;
  startedAt: number;
  steps: Partial<Record<CitationPerfStep, number>>;
  transcriptSource: CitationPerfSample['transcriptSource'];
  outcome: CitationPerfSample['outcome'] | null;
  finished: boolean;
}

interface ResourceEntryLike {
  name: string;
  initiatorType: string;
  startTime: number;
  duration: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
}

interface MediaStats {
  mediaRequests3s: number;
  mediaBytes3s: number;
  signedMediaRequests3s: number;
  signedMediaMs: number | null;
}

const MAX_SAMPLES = 50;
const MEDIA_WINDOW_MS = 3000;
const MEDIA_URL_PATTERN = /\/storage\/v1\/object\/sign\/course-materials\/|\.r2\.cloudflarestorage\.com\//;
const SIGNED_MEDIA_PATTERN = /\/functions\/v1\/signed-media/;
const UPDATE_EVENT = 'citation-perf:updated';

// Marks can land one frame after the click resolves (transcript paint), so a
// finished session stays current until the next citation open begins.
const sessions: CitationPerfSession[] = [];
let current: CitationPerfSession | null = null;
let globalInstalled = false;

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export function isCitationPerfEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('perf') === 'citations';
}

function newId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  return cryptoApi?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emitUpdate(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

function resourceEntries(): ResourceEntryLike[] {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return [];
  }
  return performance.getEntriesByType('resource') as unknown as ResourceEntryLike[];
}

function mediaStats(sample: CitationPerfSample): MediaStats {
  const windowEnd = sample.startedAt + MEDIA_WINDOW_MS;
  let mediaRequests3s = 0;
  let mediaBytes3s = 0;
  let signedMediaRequests3s = 0;
  let signedMediaMs: number | null = null;

  for (const entry of resourceEntries()) {
    if (entry.startTime < sample.startedAt || entry.startTime > windowEnd) continue;

    if (SIGNED_MEDIA_PATTERN.test(entry.name)) {
      signedMediaRequests3s += 1;
      if (signedMediaMs === null) signedMediaMs = Math.round(entry.duration);
      continue;
    }

    if (entry.initiatorType === 'video' || MEDIA_URL_PATTERN.test(entry.name)) {
      mediaRequests3s += 1;
      mediaBytes3s += Math.max(
        entry.transferSize ?? 0,
        entry.encodedBodySize ?? 0,
        entry.decodedBodySize ?? 0,
      );
    }
  }

  return { mediaRequests3s, mediaBytes3s, signedMediaRequests3s, signedMediaMs };
}

function withMedia(sample: CitationPerfSample): CitationPerfSample {
  return { ...sample, ...mediaStats(sample) };
}

function installGlobal(): void {
  if (globalInstalled || !isCitationPerfEnabled() || typeof window === 'undefined') return;
  globalInstalled = true;
  (window as unknown as { __citationPerf?: unknown }).__citationPerf = {
    snapshot: getCitationPerfSnapshot,
    clear: clearCitationPerf,
    download: downloadCitationPerf,
    resetCache: () => invalidateSignedMediaCache(),
  };
}

export function beginCitationOpen(kind: CitationPerfKind): string | null {
  if (!isCitationPerfEnabled()) return null;
  installGlobal();
  current = {
    id: newId(),
    kind,
    startedAt: now(),
    steps: {},
    transcriptSource: null,
    outcome: null,
    finished: false,
  };
  return current.id;
}

export function markCitationStep(step: CitationPerfStep): void {
  if (!current || current.steps[step] !== undefined) return;
  current.steps[step] = Math.max(0, now() - current.startedAt);
}

export function markCitationTranscriptPainted(
  source: NonNullable<CitationPerfSample['transcriptSource']>,
): void {
  if (!current) return;
  if (current.transcriptSource === null) current.transcriptSource = source;
  markCitationStep('transcript_painted');
}

export function finishCitationOpen(outcome: CitationPerfSample['outcome']): CitationPerfSample | null {
  if (!current || current.finished) return null;

  current.finished = true;
  current.outcome = outcome;
  sessions.push(current);
  if (sessions.length > MAX_SAMPLES) sessions.shift();
  emitUpdate();
  return withMedia(toSample(current));
}

function toSample(session: CitationPerfSession): CitationPerfSample {
  return {
    id: session.id,
    kind: session.kind,
    startedAt: session.startedAt,
    steps: { ...session.steps },
    durations: {
      openToSourceMs: session.steps.source_resolved ?? null,
      openToPanelMs: session.steps.panel_state ?? null,
      openToTranscriptMs: session.steps.transcript_painted ?? null,
    },
    transcriptSource: session.transcriptSource,
    mediaRequests3s: 0,
    mediaBytes3s: 0,
    signedMediaRequests3s: 0,
    signedMediaMs: null,
    outcome: session.outcome ?? 'error',
  };
}

export function getCitationPerfSnapshot(): CitationPerfSample[] {
  return sessions.map((session) => withMedia(toSample(session)));
}

export function lastCitationPerfSample(): CitationPerfSample | null {
  const latest = sessions[sessions.length - 1];
  return latest ? withMedia(toSample(latest)) : null;
}

export function clearCitationPerf(): void {
  sessions.length = 0;
  current = null;
  emitUpdate();
}

export function downloadCitationPerf(): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const payload = JSON.stringify(
    { exportedAt: new Date().toISOString(), samples: getCitationPerfSnapshot() },
    null,
    2,
  );
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `citation-perf-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
