#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const METRICS = [
  ['openToTranscriptMs', 'open -> transcript'],
  ['openToPanelMs', 'open -> panel'],
  ['mediaRequests3s', 'media requests (3s)'],
  ['mediaBytes3s', 'media bytes (3s)'],
  ['signedMediaRequests3s', 'signed-media requests (3s)'],
];

function flatten(sample) {
  return {
    ...sample,
    openToTranscriptMs: sample.durations?.openToTranscriptMs ?? null,
    openToPanelMs: sample.durations?.openToPanelMs ?? null,
    mediaRequests3s: sample.mediaRequests3s ?? 0,
    mediaBytes3s: sample.mediaBytes3s ?? 0,
    signedMediaRequests3s: sample.signedMediaRequests3s ?? 0,
  };
}

export function loadSamples(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.samples;
  if (!Array.isArray(rows)) throw new Error('Expected an array or { samples: [...] }');
  return rows.map(flatten);
}

export function percentile(values, fraction) {
  const sorted = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export function summarize(samples) {
  const result = {};
  for (const [key] of METRICS) {
    const values = samples.map((sample) => sample[key]);
    result[key] = { p50: percentile(values, 0.5), p95: percentile(values, 0.95), count: values.length };
  }
  const mediaActive = samples.filter((sample) => sample.mediaRequests3s > 0).length;
  result.mediaActiveShare = samples.length === 0 ? 0 : mediaActive / samples.length;
  return result;
}

function format(value) {
  if (value === null || value === undefined) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function deltaPercent(before, after) {
  if (before === null || after === null || before === 0) return 'n/a';
  return `${(((after - before) / before) * 100).toFixed(1)}%`;
}

function compare(baseline, after) {
  const rows = METRICS.map(([key, label]) => {
    const b = baseline[key];
    const a = after[key];
    return {
      metric: label,
      baseline: `${format(b.p50)} / ${format(b.p95)}`,
      after: `${format(a.p50)} / ${format(a.p95)}`,
      deltaP50: deltaPercent(b.p50, a.p50),
      deltaP95: deltaPercent(b.p95, a.p95),
    };
  });

  const checks = [
    {
      name: 'open_to_transcript p50 improved >= 60% or <= 250ms',
      pass: after.openToTranscriptMs.p50 !== null &&
        ((baseline.openToTranscriptMs.p50 !== null &&
          after.openToTranscriptMs.p50 <= baseline.openToTranscriptMs.p50 * 0.4) ||
          after.openToTranscriptMs.p50 <= 250),
    },
    {
      name: 'open_to_panel p50 improved >= 30%',
      pass: baseline.openToPanelMs.p50 !== null && after.openToPanelMs.p50 !== null &&
        after.openToPanelMs.p50 <= baseline.openToPanelMs.p50 * 0.7,
    },
    {
      name: 'no video media requests in the first 3s',
      pass: after.mediaActiveShare === 0,
    },
    {
      name: 'signed-media requests p50 <= 1 per open',
      pass: after.signedMediaRequests3s.p50 !== null && after.signedMediaRequests3s.p50 <= 1,
    },
  ];

  return { rows, checks };
}

function printReport(baseline, after) {
  const { rows, checks } = compare(baseline, after);
  console.log('\nCitation perf: baseline vs after (p50 / p95)\n');
  console.table(rows.map((row) => ({
    Metric: row.metric,
    Baseline: row.baseline,
    After: row.after,
    'Delta p50': row.deltaP50,
    'Delta p95': row.deltaP95,
  })));
  console.log(`\nOpens with media requests: baseline ${(baseline.mediaActiveShare * 100).toFixed(0)}%, after ${(after.mediaActiveShare * 100).toFixed(0)}%`);
  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}`);
  }
}

function main(argv) {
  const [baselinePath, afterPath] = argv;
  if (!baselinePath || !afterPath) {
    console.error('Usage: npm run perf:citations:report -- <baseline.json> <after.json>');
    process.exitCode = 1;
    return;
  }
  const baseline = summarize(loadSamples(JSON.parse(readFileSync(baselinePath, 'utf8'))));
  const after = summarize(loadSamples(JSON.parse(readFileSync(afterPath, 'utf8'))));
  printReport(baseline, after);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
