import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginCitationOpen,
  clearCitationPerf,
  finishCitationOpen,
  getCitationPerfSnapshot,
  isCitationPerfEnabled,
  markCitationStep,
  markCitationTranscriptPainted,
} from './citationPerf';

function enablePerf() {
  window.history.replaceState({}, '', '/?perf=citations');
}

function setNow(value: number) {
  vi.spyOn(performance, 'now').mockReturnValue(value);
}

function resourceEntry(overrides: Partial<PerformanceResourceTiming>): PerformanceResourceTiming {
  return {
    name: 'https://example.test/asset',
    initiatorType: 'fetch',
    startTime: 0,
    duration: 1,
    transferSize: 0,
    encodedBodySize: 0,
    decodedBodySize: 0,
    ...overrides,
  } as PerformanceResourceTiming;
}

describe('citationPerf', () => {
  beforeEach(() => {
    clearCitationPerf();
    enablePerf();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('records first-write-wins marks relative to the click', () => {
    let clock = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    clock = 100; // begin
    beginCitationOpen('video');
    clock = 150; // source_resolved
    markCitationStep('source_resolved');
    clock = 999; // duplicate source_resolved, ignored
    markCitationStep('source_resolved');
    clock = 200; // panel_state
    markCitationStep('panel_state');
    const sample = finishCitationOpen('success');

    expect(sample?.durations).toEqual({
      openToSourceMs: 50,
      openToPanelMs: 100,
      openToTranscriptMs: null,
    });
  });

  it('accepts a transcript paint mark after the open has finished', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(0); // begin
    now.mockReturnValueOnce(10); // panel_state
    now.mockReturnValueOnce(20); // transcript paint

    beginCitationOpen('video');
    markCitationStep('panel_state');
    finishCitationOpen('success');
    markCitationTranscriptPainted('evidence');

    const [sample] = getCitationPerfSnapshot();
    expect(sample.durations.openToTranscriptMs).toBe(20);
    expect(sample.transcriptSource).toBe('evidence');
  });

  it('counts media and signed-media requests inside the first three seconds', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1_000);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      resourceEntry({ name: 'https://cdn.test/lecture.mp4', initiatorType: 'video', startTime: 1_100, transferSize: 5_000 }),
      resourceEntry({ name: 'https://account.r2.cloudflarestorage.com/bucket/lecture.mp4', startTime: 1_200, encodedBodySize: 2_000 }),
      resourceEntry({ name: 'https://project.supabase.co/functions/v1/signed-media', startTime: 1_050, duration: 42 }),
      resourceEntry({ name: 'https://project.supabase.co/rest/v1/chunks', startTime: 1_100 }),
      resourceEntry({ name: 'https://cdn.test/lecture.mp4', initiatorType: 'video', startTime: 5_000, transferSize: 9_999 }),
    ]);

    beginCitationOpen('video');
    markCitationStep('panel_state');
    finishCitationOpen('success');

    const [sample] = getCitationPerfSnapshot();
    expect(sample.mediaRequests3s).toBe(2);
    expect(sample.mediaBytes3s).toBe(7_000);
    expect(sample.signedMediaRequests3s).toBe(1);
    expect(sample.signedMediaMs).toBe(42);
  });

  it('caps the ring buffer at 50 samples', () => {
    setNow(0);
    for (let index = 0; index < 55; index += 1) {
      beginCitationOpen('pdf');
      finishCitationOpen('success');
    }

    expect(getCitationPerfSnapshot()).toHaveLength(50);
  });

  it('is a no-op when the debug flag is absent', () => {
    window.history.replaceState({}, '', '/');

    expect(isCitationPerfEnabled()).toBe(false);
    expect(beginCitationOpen('video')).toBeNull();
    markCitationStep('panel_state');
    expect(finishCitationOpen('success')).toBeNull();
    expect(getCitationPerfSnapshot()).toEqual([]);
  });
});
