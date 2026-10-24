import { useState } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  // The chosen dates, shown on the button for a custom range.
  rangeLabel: string | null;
}

const OPTIONS: ReadonlyArray<{ value: RangePreset; label: string }> = [
  ...RANGE_PRESETS.map((option) => ({ value: option.value, label: `Last ${option.label}` })),
  { value: 'custom', label: 'Custom range' },
];

function buttonLabel(preset: RangePreset, rangeLabel: string | null): string {
  if (preset === 'custom') return rangeLabel ?? 'Custom range';
  return OPTIONS.find((option) => option.value === preset)?.label ?? 'Custom range';
}

// One button showing the dates; its menu holds the presets and, for a
// custom range, the start and end inputs. Keeps the top bar one row.
export function AnalyticsRangePicker(props: AnalyticsRangePickerProps) {
  const { preset, onPresetChange, customStart, customEnd, onCustomStartChange, onCustomEndChange, error, rangeLabel } = props;
  const [open, setOpen] = useState(false);

  const choose = (value: RangePreset) => {
    onPresetChange(value);
    // A custom range still needs its dates, so keep the menu open.
    if (value !== 'custom') setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-8 gap-2 font-normal', error && 'border-destructive')}>
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {buttonLabel(preset, rangeLabel)}
          <ChevronDown className="h-4 w-4 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div role="radiogroup" aria-label="Date range">
          {OPTIONS.map((option) => {
            const isChecked = preset === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isChecked}
                onClick={() => choose(option.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Check className={cn('h-4 w-4', isChecked ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>

        {preset === 'custom' && (
          <div className="space-y-2 border-t border-border p-2 pt-3">
            <div className="space-y-1">
              <Label htmlFor="analytics-start-at" className="text-xs text-muted-foreground">Start</Label>
              <Input
                id="analytics-start-at"
                type="datetime-local"
                value={customStart}
                onChange={(event) => onCustomStartChange(event.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="analytics-end-at" className="text-xs text-muted-foreground">End</Label>
              <Input
                id="analytics-end-at"
                type="datetime-local"
                value={customEnd}
                onChange={(event) => onCustomEndChange(event.target.value)}
                className="h-8 text-sm"
              />
            </div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
