import type { ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, FileText, Loader2, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { RichMarkdown } from '@/features/student-chat/RichMarkdown';

import type { QuestionDetail } from './analyticsApi';
import { categoryLabel } from './questionCategories';
import { groupSourcesByFile, stripCitationMarkers } from './questionFilters';
import type { LoadState } from './useLoader';

interface QuestionDetailPaneProps {
  detail: LoadState<QuestionDetail | null>;
  hasSelection: boolean;
  onSelectQuestion(id: string): void;
  // Small screens show one pane at a time.
  onBack?(): void;
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function AnswerStatus({ detail }: { detail: QuestionDetail }) {
  if (detail.needsAttention) {
    return (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
        Not answered from the materials
      </span>
    );
  }
  if (detail.answeredFromMaterials) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
        Answered from the materials
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <CircleDashed className="h-4 w-4" aria-hidden="true" />
      {detail.isStudyQuestion === false ? 'Not a study question' : 'Not labelled yet'}
    </span>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <p className="p-6 text-sm text-muted-foreground">{children}</p>;
}

// The right pane: one question in full, so a lecturer can judge the answer
// and where it came from.
export function QuestionDetailPane({ detail, hasSelection, onSelectQuestion, onBack }: QuestionDetailPaneProps) {
  const back = onBack && (
    <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-muted-foreground lg:hidden" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to questions
    </Button>
  );

  if (!hasSelection) return <Message>Pick a question to see the answer it got.</Message>;
  if (detail.error) return <p role="alert" className="p-6 text-sm text-destructive">{detail.error}</p>;
  if (detail.isLoading && !detail.data) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading question" />
      </div>
    );
  }
  const question = detail.data;
  if (!question) return <Message>This question isn't in the selected dates.</Message>;

  const sources = groupSourcesByFile(question.sources);
  const moreRelated = question.relatedCount - question.related.length;

  return (
    <article className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {back}
      <header className="space-y-2">
        <h2 className="text-lg font-semibold leading-snug">{question.queryText}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{formatDateTime(question.createdAt)}</span>
          <span>{categoryLabel(question.category)}</span>
          <AnswerStatus detail={question} />
        </div>
      </header>

      <Block title="Answer given">
        {question.answerText ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <RichMarkdown content={stripCitationMarkers(question.answerText)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">The answer wasn't saved.</p>
        )}
      </Block>

      <Block title="Cited">
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">The answer cited nothing.</p>
        ) : (
          <ul className="space-y-1.5">
            {sources.map((group) => {
              const Icon = group.fileType === 'video' ? Video : FileText;
              return (
                <li key={group.fileName} className="flex items-start gap-2 text-sm">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="break-words font-medium">{group.fileName}</span>
                    {group.places.length > 0 && (
                      <>
                        <span className="text-muted-foreground"> — </span>
                        <span className="text-muted-foreground">{group.places.join(', ')}</span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block title="Also asked about the same subject">
        {question.related.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other questions on the same subject.</p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {question.related.map((related) => (
                <li key={related.id}>
                  <button
                    type="button"
                    onClick={() => onSelectQuestion(related.id)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {related.needsAttention && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-label="Not from materials" />}
                    <span className="line-clamp-2">{related.queryText}</span>
                  </button>
                </li>
              ))}
            </ul>
            {moreRelated > 0 && <p className="text-xs text-muted-foreground">and {moreRelated} more</p>}
          </>
        )}
      </Block>
    </article>
  );
}
