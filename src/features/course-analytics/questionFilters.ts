// Filters for the analytics question list, and how they map to the
// get_course_questions RPC (migration 20261025090000).
import {
  formatPlaceLabel,
  placeKey,
  type PlaceFilter,
} from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import { categoryLabel } from './questionCategories';

export type SourceKind = 'document' | 'video';

export interface TopicFilter {
  text: string;
  // Pages and moments the topic was found in; null for a term picked from
  // the term list, which only matches question text.
  places: PlaceFilter[] | null;
  source: 'search' | 'term';
}

export interface PlaceChoice {
  key: string;
  label: string;
  filter: PlaceFilter;
}

export interface QuestionFilters {
  topic: TopicFilter | null;
  material: { id: string; name: string } | null;
  place: PlaceChoice | null;
  sourceKind: SourceKind | null;
  category: string | null;
  needsAttention: boolean;
}

export const NO_FILTERS: QuestionFilters = {
  topic: null,
  material: null,
  place: null,
  sourceKind: null,
  category: null,
  needsAttention: false,
};

export type FilterName = keyof QuestionFilters;

export interface QuestionArgs {
  in_topic_text: string | null;
  in_topic_places: PlaceFilter[] | null;
  in_places: PlaceFilter[] | null;
  in_material_id: string | null;
  in_source_kind: SourceKind | null;
  in_category: string | null;
  in_needs_attention: boolean;
}

export function toQuestionArgs(filters: QuestionFilters): QuestionArgs {
  return {
    in_topic_text: filters.topic?.text ?? null,
    in_topic_places: filters.topic?.places ?? null,
    in_places: filters.place ? [filters.place.filter] : null,
    in_material_id: filters.material?.id ?? null,
    in_source_kind: filters.sourceKind,
    in_category: filters.category,
    in_needs_attention: filters.needsAttention,
  };
}

export function hasFilters(filters: QuestionFilters): boolean {
  return activeFilters(filters).length > 0;
}

export interface ActiveFilter {
  name: FilterName;
  label: string;
}

export function activeFilters(filters: QuestionFilters): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  if (filters.topic) {
    const verb = filters.topic.source === 'term' ? 'Mentions' : 'About';
    active.push({ name: 'topic', label: `${verb} “${filters.topic.text}”` });
  }
  if (filters.needsAttention) active.push({ name: 'needsAttention', label: 'Needs attention' });
  if (filters.material) active.push({ name: 'material', label: `Cited ${filters.material.name}` });
  if (filters.place) active.push({ name: 'place', label: `Cited ${filters.place.label}` });
  if (filters.sourceKind) {
    active.push({ name: 'sourceKind', label: filters.sourceKind === 'video' ? 'Cited a video' : 'Cited a document' });
  }
  if (filters.category) active.push({ name: 'category', label: categoryLabel(filters.category) });
  return active;
}

export function withoutFilter(filters: QuestionFilters, name: FilterName): QuestionFilters {
  return { ...filters, [name]: NO_FILTERS[name] };
}

// What an answer cited: one page of a document, or a moment of a video.
export interface QuestionSource {
  materialId: string;
  fileName: string;
  fileType: string;
  pageNumber: number | null;
  startMs: number | null;
  endMs: number | null;
}

function formatMoment(ms: number): string {
  // formatPlaceLabel prints a range; a citation tag only needs its start.
  return formatPlaceLabel({ pageNumber: null, startMs: ms, endMs: ms }).split('–')[0];
}

// "Hashing.pdf · Page 2", "Lecture 4.mp4 · 1:05" or just the file name.
export function sourceLabel(source: QuestionSource): string {
  if (source.startMs !== null) return `${source.fileName} · ${formatMoment(source.startMs)}`;
  if (source.pageNumber !== null) return `${source.fileName} · Page ${source.pageNumber}`;
  return source.fileName;
}

// The place filter that finds questions citing this source.
export function sourceToPlace(source: QuestionSource): PlaceChoice {
  const filter: PlaceFilter = source.startMs !== null
    ? { material_id: source.materialId, start_ms: source.startMs, end_ms: source.endMs ?? source.startMs }
    : { material_id: source.materialId, page_number: source.pageNumber };
  const location = source.startMs !== null
    ? { pageNumber: null, startMs: source.startMs, endMs: source.endMs ?? source.startMs }
    : { pageNumber: source.pageNumber, startMs: null, endMs: null };
  return { key: placeKey({ materialId: source.materialId, ...location }), label: sourceLabel(source), filter };
}
