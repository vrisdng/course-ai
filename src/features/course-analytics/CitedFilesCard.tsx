import { useState } from 'react';
import { FileText, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { AnalyticsCard, CardEmpty, CardError, CardLoading } from './AnalyticsCard';
import type { CitedMaterial, QuestionOverview } from './analyticsApi';
import { ProportionBar } from './ProportionBar';
import { plural } from './questionCategories';
import type { SourceKind } from './questionFilters';
import type { LoadState } from './useLoader';

const FILES_SHOWN = 8;

interface CitedFilesCardProps {
  files: LoadState<CitedMaterial[]>;
  overview: QuestionOverview | null;
  selectedFileId: string | null;
  selectedSourceKind: SourceKind | null;
  onSelectFile(file: { id: string; name: string }): void;
  onSelectSourceKind(kind: SourceKind): void;
}

function FilterRow({ label, count, max, isSelected, icon, onClick }: {
  label: string;
  count: number;
  max: number;
  isSelected: boolean;
  icon: 'document' | 'video';
  onClick(): void;
}) {
  const Icon = icon === 'video' ? Video : FileText;
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected ? 'bg-secondary' : 'hover:bg-muted/60',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="block truncate text-sm">{label}</span>
        <ProportionBar value={count} max={max} />
      </span>
      <span className="sr-only">, </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{plural(count, 'question')}</span>
    </button>
  );
}

// Which files answers drew on: documents vs videos, then file by file.
export function CitedFilesCard({ files, overview, selectedFileId, selectedSourceKind, onSelectFile, onSelectSourceKind }: CitedFilesCardProps) {
  const [showAll, setShowAll] = useState(false);
  const list = files.data ?? [];
  const shown = showAll ? list : list.slice(0, FILES_SHOWN);
  const maxFile = Math.max(1, ...list.map((file) => file.questionCount));
  const cited = overview?.citedQuestionCount ?? 0;

  return (
    <AnalyticsCard title="Cited files" description="Files that answers drew on, by number of questions.">
      {files.error ? <CardError message={files.error} />
        : files.isLoading && !files.data ? <CardLoading label="Loading cited files" />
        : list.length === 0 ? (
          <CardEmpty>No answers cited your materials in these dates.</CardEmpty>
        ) : (
          <div className="space-y-4">
            {overview && cited > 0 && (
              <div className="space-y-1 border-b border-border pb-3">
                <FilterRow
                  label="Documents"
                  icon="document"
                  count={overview.documentQuestionCount}
                  max={cited}
                  isSelected={selectedSourceKind === 'document'}
                  onClick={() => onSelectSourceKind('document')}
                />
                <FilterRow
                  label="Videos"
                  icon="video"
                  count={overview.videoQuestionCount}
                  max={cited}
                  isSelected={selectedSourceKind === 'video'}
                  onClick={() => onSelectSourceKind('video')}
                />
              </div>
            )}
            <ul className="space-y-1">
              {shown.map((file) => (
                <li key={file.materialId}>
                  <FilterRow
                    label={file.fileName}
                    icon={file.fileType === 'video' ? 'video' : 'document'}
                    count={file.questionCount}
                    max={maxFile}
                    isSelected={selectedFileId === file.materialId}
                    onClick={() => onSelectFile({ id: file.materialId, name: file.fileName })}
                  />
                </li>
              ))}
            </ul>
            {list.length > FILES_SHOWN && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll((current) => !current)}>
                {showAll ? 'Show fewer' : `Show all ${list.length} files`}
              </Button>
            )}
          </div>
        )}
    </AnalyticsCard>
  );
}
