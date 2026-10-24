import { Button } from '@/components/ui/button';

import {
  formatPlaceLabel,
  toPlaceFilters,
} from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import { AnalyticsCard, CardEmpty, CardError, CardLoading } from './AnalyticsCard';
import type { AnalyticsQuestion, CitedPlace } from './analyticsApi';
import type { PlaceChoice } from './questionFilters';
import { plural } from './questionCategories';
import { SourceTag } from './SourceTag';
import type { LoadState } from './useLoader';

interface NeedsAttentionCardProps {
  count: number | null;
  examples: LoadState<AnalyticsQuestion[]>;
  places: LoadState<CitedPlace[]>;
  onShowNeedsAttention(): void;
  onSelectPlace(place: PlaceChoice): void;
}

function toChoice(place: CitedPlace): PlaceChoice {
  const label = place.startMs === null && place.pageNumber === null
    ? place.fileName
    : `${place.fileName} · ${formatPlaceLabel(place)}`;
  const [filter] = toPlaceFilters([{ ...place, similarity: 0, snippet: '', chunkCount: 0 }]);
  return { key: place.key, label, filter };
}

// What to look at first: questions the materials couldn't answer, and the
// pages and video moments that questions keep landing on.
export function NeedsAttentionCard({ count, examples, places, onShowNeedsAttention, onSelectPlace }: NeedsAttentionCardProps) {
  return (
    <AnalyticsCard title="Needs attention">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <h3 className="text-sm font-medium">Not answered from your materials</h3>
          {examples.error ? <CardError message={examples.error} />
            : examples.isLoading && !examples.data ? <CardLoading label="Loading questions needing attention" />
            : !count ? (
              <CardEmpty>Every study question was answered from your materials.</CardEmpty>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {plural(count, 'study question')} got an answer that didn't come from the course materials.
                  They may point to something the materials don't cover.
                </p>
                <ul className="space-y-2">
                  {(examples.data ?? []).map((question) => (
                    <li key={question.id} className="rounded-md bg-muted/40 px-3 py-2 text-sm">{question.queryText}</li>
                  ))}
                </ul>
                <Button variant="outline" size="sm" onClick={onShowNeedsAttention}>Show all {count}</Button>
              </>
            )}
        </div>

        <div className="min-w-0 space-y-3">
          <h3 className="text-sm font-medium">Most-asked pages and moments</h3>
          {places.error ? <CardError message={places.error} />
            : places.isLoading && !places.data ? <CardLoading label="Loading most-asked places" />
            : !places.data?.length ? (
              <CardEmpty>No answers cited the materials in these dates.</CardEmpty>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Where answers kept citing. Open one to read the questions.</p>
                <ul className="space-y-2">
                  {places.data.map((place) => {
                    const choice = toChoice(place);
                    return (
                      <li key={place.key}>
                        <SourceTag
                          label={choice.label}
                          fileType={place.fileType}
                          detail={plural(place.questionCount, 'question')}
                          onClick={() => onSelectPlace(choice)}
                          className="w-full justify-between py-1.5 text-sm"
                        />
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
        </div>
      </div>
    </AnalyticsCard>
  );
}
