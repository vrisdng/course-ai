// A thin bar showing value / max beside a count that is always printed as
// text, so the bar never carries the number on its own.
export function ProportionBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
      <div className="h-full rounded bg-primary/70" style={{ width: `${percent}%` }} />
    </div>
  );
}
