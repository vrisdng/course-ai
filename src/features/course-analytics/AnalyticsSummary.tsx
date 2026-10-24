import { Skeleton } from '@/components/ui/skeleton';

import type { QuestionBucket } from './analyticsApi';

export interface CourseStats {
  enrolledStudents: number;
  activeStudents: number;
  documents: number;
  totalQuestions: number;
}

interface AnalyticsSummaryProps {
  isLoading: boolean;
  stats: CourseStats | null;
  buckets: QuestionBucket[];
  citedMaterialCount: number | null;
}

function Tile({ label, value, detail, isLoading }: { label: string; value: string; detail?: string; isLoading: boolean }) {
  const id = `summary-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div role="group" aria-labelledby={id} className="rounded-xl border border-border bg-card p-4">
      <p id={id} className="text-xs font-medium text-muted-foreground">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      )}
      {detail && !isLoading && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function AnalyticsSummary({ isLoading, stats, buckets, citedMaterialCount }: AnalyticsSummaryProps) {
  const labelled = buckets.reduce((sum, bucket) => sum + bucket.labeledCount, 0);
  const answered = buckets.reduce((sum, bucket) => sum + bucket.answeredFromMaterialsCount, 0);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Questions" isLoading={isLoading} value={stats ? String(stats.totalQuestions) : '—'} />
      <Tile
        label="Active students"
        isLoading={isLoading}
        value={stats ? String(stats.activeStudents) : '—'}
        detail={stats ? `of ${stats.enrolledStudents} enrolled` : undefined}
      />
      <Tile
        label="Answered from materials"
        isLoading={false}
        value={labelled > 0 ? `${Math.round((answered / labelled) * 100)}%` : '—'}
        detail={labelled > 0 ? `${answered} of ${labelled} labelled` : undefined}
      />
      <Tile
        label="Materials cited"
        isLoading={isLoading}
        value={citedMaterialCount === null ? '—' : String(citedMaterialCount)}
        detail={stats && citedMaterialCount !== null ? `of ${stats.documents} materials` : undefined}
      />
    </div>
  );
}
