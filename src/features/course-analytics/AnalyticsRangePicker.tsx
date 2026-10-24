import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { RANGE_PRESETS, type RangePreset } from './analyticsRange';

interface AnalyticsRangePickerProps {
  preset: RangePreset;
  onPresetChange(preset: RangePreset): void;
  customStart: string;
  customEnd: string;
  onCustomStartChange(value: string): void;
  onCustomEndChange(value: string): void;
  error: string | null;
}

const OPTIONS: ReadonlyArray<{ value: RangePreset; label: string }> = [
  ...RANGE_PRESETS,
  { value: 'custom', label: 'Custom' },
];

export function AnalyticsRangePicker(props: AnalyticsRangePickerProps) {
  const { preset, onPresetChange, customStart, customEnd, onCustomStartChange, onCustomEndChange, error } = props;

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={preset === option.value}
            onClick={() => onPresetChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              preset === option.value
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="analytics-start-at" className="text-xs text-muted-foreground">Start</Label>
            <Input
              id="analytics-start-at"
              type="datetime-local"
              value={customStart}
              onChange={(event) => onCustomStartChange(event.target.value)}
              className="w-[220px] text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-end-at" className="text-xs text-muted-foreground">End</Label>
            <Input
              id="analytics-end-at"
              type="datetime-local"
              value={customEnd}
              onChange={(event) => onCustomEndChange(event.target.value)}
              className="w-[220px] text-sm"
            />
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
