import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';

import type { QuestionOverview } from './analyticsApi';
import type { LoadState } from './useLoader';

interface OverviewNumbersProps {
  overview: LoadState<QuestionOverview>;
  onShowNeedsAttention(): void;
}

function Figure({ label, value, detail, isLoading }: { label: string; value: string; detail?: ReactNode; isLoading: boolean }) {
  const id = `overview-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div role="group" aria-labelledby={id} className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <p id={id} className="text-xs font-medium text-muted-foreground">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-2 h-7 w-14" aria-label="Loading" />
      ) : (
        <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      )}
      {detail && !isLoading && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

// The headline numbers for the dates chosen.
export function OverviewNumbers({ overview, onShowNeedsAttention }: OverviewNumbersProps) {
  const { data, isLoading, error } = overview;
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;

  const answeredShare = data && data.labeledCount > 0
    ? `${Math.round((data.answeredFromMaterialsCount / data.labeledCount) * 100)}%`
    : '—';

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure label="Questions" isLoading={isLoading} value={data ? String(data.questionCount) : '—'} />
      <Figure label="Students asking" isLoading={isLoading} value={data ? String(data.studentCount) : '—'} />
      <Figure
        label="Answered from materials"
        isLoading={isLoading}
        value={answeredShare}
        detail={data && data.labeledCount > 0 ? `${data.answeredFromMaterialsCount} of ${data.labeledCount} labelled` : undefined}
      />
      <Figure
        label="Needs attention"
        isLoading={isLoading}
        value={data ? String(data.needsAttentionCount) : '—'}
        detail={data && data.needsAttentionCount > 0 ? (
          <button
            type="button"
            onClick={onShowNeedsAttention}
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
          >
            <AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />
            {data.needsAttentionCount} need attention — show
          </button>
        ) : undefined}
      />
    </div>
  );
}
