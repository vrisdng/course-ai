import type { ReactNode } from 'react';
import { AlertTriangle, FileText, Inbox, Loader2, Video } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { CitedFile, QuestionOverview } from './analyticsApi';
import { categoryLabel } from './questionCategories';
import { ALL_QUESTIONS, isSameSelection, type Selection } from './questionFilters';
import type { LoadState } from './useLoader';
import type { QuestionLabelsState } from './useQuestionLabels';

interface NavPaneProps {
  overview: LoadState<QuestionOverview>;
  files: LoadState<CitedFile[]>;
  labels: QuestionLabelsState;
  selection: Selection;
  // Whether greetings and logistics are hidden, so counts match the list.
  studyOnly: boolean;
  onSelect(selection: Selection): void;
}

function NavItem({ label, count, icon, isCurrent, onClick }: {
  label: string;
  count: number | null;
  icon?: ReactNode;
  isCurrent: boolean;
  onClick(): void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={isCurrent ? 'true' : undefined}
        aria-label={count === null ? label : `${label}, ${count}`}
        title={label}
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isCurrent ? 'bg-secondary font-medium text-foreground' : 'text-foreground/80 hover:bg-muted',
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>}
      </button>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function SectionBody<T>({ state, label, empty, children }: {
  state: LoadState<T[]>;
  label: string;
  empty: string;
  children(items: T[]): ReactNode;
}) {
  if (state.error) return <p className="px-2 text-xs text-destructive">{state.error}</p>;
  if (state.isLoading && !state.data) {
    return <Loader2 className="mx-2 h-4 w-4 animate-spin text-muted-foreground" aria-label={label} />;
  }
  if (!state.data?.length) return <p className="px-2 text-xs text-muted-foreground">{empty}</p>;
  return <ul className="space-y-0.5">{children(state.data)}</ul>;
}

const iconClass = 'h-4 w-4 shrink-0 text-muted-foreground';

// The left pane: what to look at. Each item selects the questions shown in
// the middle pane.
export function NavPane({ overview, files, labels, selection, studyOnly, onSelect }: NavPaneProps) {
  const pick = (next: Selection) => () => onSelect(next);
  const current = (candidate: Selection) => isSameSelection(selection, candidate);
  const bucketState: LoadState<QuestionLabelsState['buckets']> = {
    data: labels.buckets,
    isLoading: labels.isLoadingBuckets,
    error: labels.bucketError,
  };

  return (
    <nav aria-label="Question views" className="space-y-6 p-3">
      <ul className="space-y-0.5">
        <NavItem
          label="All questions"
          count={overview.data ? overview.data.questionCount - (studyOnly ? overview.data.nonStudyCount : 0) : null}
          icon={<Inbox className={iconClass} aria-hidden="true" />}
          isCurrent={current(ALL_QUESTIONS)}
          onClick={pick(ALL_QUESTIONS)}
        />
        <NavItem
          label="Not from materials"
          count={overview.data?.needsAttentionCount ?? null}
          icon={<AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
          isCurrent={current({ kind: 'attention' })}
          onClick={pick({ kind: 'attention' })}
        />
      </ul>

      <Section title="Files">
        <SectionBody state={files} label="Loading files" empty="No answers cited your materials.">
          {(items) => items.map((file) => {
            const next: Selection = { kind: 'file', name: file.fileName, fileType: file.fileType, ids: file.materialIds };
            const Icon = file.fileType === 'video' ? Video : FileText;
            return (
              <NavItem
                key={file.fileName}
                label={file.fileName}
                count={file.questionCount}
                icon={<Icon className={iconClass} aria-hidden="true" />}
                isCurrent={current(next)}
                onClick={pick(next)}
              />
            );
          })}
        </SectionBody>
      </Section>

      <Section title="Question types">
        <SectionBody state={bucketState} label="Loading question types" empty="No questions in these dates.">
          {(items) => items.map((bucket) => {
            const next: Selection = { kind: 'type', category: bucket.category };
            return (
              <NavItem
                key={bucket.category}
                label={categoryLabel(bucket.category)}
                count={bucket.questionCount}
                isCurrent={current(next)}
                onClick={pick(next)}
              />
            );
          })}
        </SectionBody>
        {labels.isLabelling && (
          <p className="flex items-center gap-1.5 px-2 pt-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Labelling questions…{labels.remaining !== null ? ` ${labels.remaining} left` : ''}
          </p>
        )}
        {labels.labelError && (
          <p className="px-2 pt-1 text-xs text-destructive">Some questions couldn't be labelled: {labels.labelError}</p>
        )}
      </Section>
    </nav>
  );
}
