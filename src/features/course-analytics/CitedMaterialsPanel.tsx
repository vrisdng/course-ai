import { ChevronDown, ChevronRight, FileText, Loader2, Video } from 'lucide-react';

import { formatPlaceLabel } from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import { ProportionBar } from './ProportionBar';
import { plural } from './questionCategories';
import type { CitedMaterialsState } from './useCitedMaterials';

function MaterialIcon({ fileType }: { fileType: string }) {
  const Icon = fileType === 'video' ? Video : FileText;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function CitedMaterialsPanel({ state }: { state: CitedMaterialsState }) {
  const { materials, isLoading, error, expanded, toggleMaterial } = state;

  if (error) {
    return <p role="alert" className="text-sm text-destructive">{error}</p>;
  }
  if (isLoading && materials.length === 0) {
    return (
      <div className="flex justify-center py-8" aria-label="Loading cited materials">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (materials.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No answers cited course materials in this window.
      </p>
    );
  }

  const maxQuestions = Math.max(...materials.map((material) => material.questionCount));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Materials students' answers cited, most-asked first. Open one to see which pages or video moments.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {materials.map((material) => {
          const detail = expanded[material.materialId];
          const isOpen = Boolean(detail);
          const maxPlaceQuestions = Math.max(1, ...(detail?.places ?? []).map((place) => place.questionCount));
          return (
            <li key={material.materialId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={isOpen}
                onClick={() => toggleMaterial(material.materialId)}
              >
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <MaterialIcon fileType={material.fileType} />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block truncate text-sm font-medium">{material.fileName}</span>
                  <ProportionBar value={material.questionCount} max={maxQuestions} />
                </span>
                <span className="flex shrink-0 flex-col items-end text-xs">
                  <span className="font-semibold tabular-nums">{plural(material.questionCount, 'question')}</span>
                  <span className="text-muted-foreground tabular-nums">{plural(material.studentCount, 'student')}</span>
                </span>
              </button>
              {detail && (
                <div className="border-t border-border bg-muted/20 px-4 py-3 pl-11">
                  {detail.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading places" />}
                  {detail.error && <p role="alert" className="text-sm text-destructive">{detail.error}</p>}
                  {detail.places && (
                    <ul className="space-y-2">
                      {detail.places.map((place) => (
                        <li key={place.key} className="flex items-center gap-3 text-sm">
                          <span className="w-28 shrink-0 tabular-nums">{formatPlaceLabel(place)}</span>
                          <span className="min-w-0 flex-1"><ProportionBar value={place.questionCount} max={maxPlaceQuestions} /></span>
                          <span className="w-24 shrink-0 text-right text-xs tabular-nums">{plural(place.questionCount, 'question')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
