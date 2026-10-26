import { describe, expect, it } from 'vitest';

import { loadSamples, percentile, summarize } from './citation-perf-report.mjs';

const sample = (overrides) => ({
  durations: { openToTranscriptMs: 100, openToPanelMs: 50, openToSourceMs: 20 },
  mediaRequests3s: 0,
  mediaBytes3s: 0,
  signedMediaRequests3s: 0,
  ...overrides,
});

describe('citation-perf-report', () => {
  it('computes p50 and p95 with the nearest-rank method', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBeNull();
  });

  it('accepts either a bare array or an exported { samples } payload', () => {
    expect(loadSamples([sample({})])).toHaveLength(1);
    expect(loadSamples({ samples: [sample({})] })).toHaveLength(1);
    expect(() => loadSamples({})).toThrow();
  });

  it('flattens durations and reports the share of opens with media requests', () => {
    const result = summarize(loadSamples([
      sample({ mediaRequests3s: 2 }),
      sample({ mediaRequests3s: 0, durations: { openToTranscriptMs: 200, openToPanelMs: 60, openToSourceMs: 20 } }),
    ]));

    expect(result.openToTranscriptMs).toEqual({ p50: 100, p95: 200, count: 2 });
    expect(result.mediaActiveShare).toBe(0.5);
  });
});
