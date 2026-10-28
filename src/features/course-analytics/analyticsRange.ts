// Date ranges for the analytics page: quick presets ending now, or a custom
// pair of local date-times.
import type { AnalyticsRange } from './analyticsApi';

export type RangePreset = '7d' | '30d' | '90d' | 'custom';

export const RANGE_PRESETS: ReadonlyArray<{ value: Exclude<RangePreset, 'custom'>; label: string; days: number }> = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
];

export const DEFAULT_PRESET: RangePreset = '30d';

const DAY_MS = 24 * 60 * 60 * 1000;

export function presetRange(days: number, now: Date = new Date()): AnalyticsRange {
  return { startAt: new Date(now.getTime() - days * DAY_MS).toISOString(), endAt: now.toISOString() };
}

const pad = (value: number) => String(value).padStart(2, '0');

// Value for <input type="datetime-local">, in local time.
export function formatDateTimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value: string): Date | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveCustomRange(
  startInput: string,
  endInput: string,
): { range: AnalyticsRange; error: null } | { range: null; error: string } {
  const start = parseDateTimeLocalValue(startInput);
  const end = parseDateTimeLocalValue(endInput);
  const error = !startInput.trim()
    ? 'Choose a start date and time.'
    : !start
      ? 'Enter a valid start date and time.'
      : !endInput.trim()
        ? 'Choose an end date and time.'
        : !end
          ? 'Enter a valid end date and time.'
          : start.getTime() > end.getTime()
            ? 'Start date and time must be earlier than or equal to the end date and time.'
            : null;
  if (error || !start || !end) return { range: null, error: error ?? 'Enter a valid date range.' };
  return { range: { startAt: start.toISOString(), endAt: end.toISOString() }, error: null };
}

const labelFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// "1 Oct 2026 – 24 Oct 2026"
export function formatRangeLabel(range: AnalyticsRange): string {
  return `${labelFormatter.format(new Date(range.startAt))} – ${labelFormatter.format(new Date(range.endAt))}`;
}
