// What the analytics page shows: one selection from the left pane (all
// questions, a topic, a file, ...), mapped to get_course_questions filters
// (migrations 20261025090000 and 20261025120000).
import type { PlaceFilter } from '../../../supabase/functions/_shared/analyticsPlaces.ts';

import { categoryLabel } from './questionCategories';

export type Selection =
  | { kind: 'all' }
  | { kind: 'attention' }
  | { kind: 'term'; term: string }
  // A typed search: question text, or answers citing where the materials
  // cover it (places; null when the materials search failed).
  | { kind: 'search'; text: string; places: PlaceFilter[] | null }
  // Copies of a file share its name, so a file is the set of their ids.
  | { kind: 'file'; name: string; fileType: string; ids: string[] }
  | { kind: 'type'; category: string };

export const ALL_QUESTIONS: Selection = { kind: 'all' };

export interface QuestionFilters {
  topicText: string | null;
  topicPlaces: PlaceFilter[] | null;
  materialIds: string[] | null;
  category: string | null;
  needsAttention: boolean;
  // Hide greetings and logistics (questions labelled not study questions).
  studyOnly: boolean;
}

export function filtersFor(selection: Selection, studyOnly: boolean): QuestionFilters {
  return {
    topicText: selection.kind === 'term' ? selection.term : selection.kind === 'search' ? selection.text : null,
    topicPlaces: selection.kind === 'search' ? selection.places : null,
    materialIds: selection.kind === 'file' ? selection.ids : null,
    category: selection.kind === 'type' ? selection.category : null,
    needsAttention: selection.kind === 'attention',
    studyOnly,
  };
}

export interface QuestionArgs {
  in_topic_text: string | null;
  in_topic_places: PlaceFilter[] | null;
  in_places: PlaceFilter[] | null;
  in_material_ids: string[] | null;
  in_source_kind: 'document' | 'video' | null;
  in_category: string | null;
  in_needs_attention: boolean;
  in_study_only: boolean;
}

export function toQuestionArgs(filters: QuestionFilters): QuestionArgs {
  return {
    in_topic_text: filters.topicText,
    in_topic_places: filters.topicPlaces,
    in_places: null,
    in_material_ids: filters.materialIds,
    in_source_kind: null,
    in_category: filters.category,
    in_needs_attention: filters.needsAttention,
    in_study_only: filters.studyOnly,
  };
}

export function selectionTitle(selection: Selection): string {
  switch (selection.kind) {
    case 'all': return 'All questions';
    case 'attention': return 'Not answered from materials';
    case 'term': return `Mentions “${selection.term}”`;
    case 'search': return `About “${selection.text}”`;
    case 'file': return `Cited ${selection.name}`;
    case 'type': return categoryLabel(selection.category);
  }
}

function selectionKey(selection: Selection): string {
  switch (selection.kind) {
    case 'term': return `term:${selection.term}`;
    case 'search': return `search:${selection.text}`;
    case 'file': return `file:${selection.name}`;
    case 'type': return `type:${selection.category}`;
    default: return selection.kind;
  }
}

export function isSameSelection(a: Selection, b: Selection): boolean {
  return selectionKey(a) === selectionKey(b);
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
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export interface SourceGroup {
  fileName: string;
  fileType: string;
  // "Page 2" or "1:05", in order; empty when the whole file was cited.
  places: string[];
}

export function groupSourcesByFile(sources: ReadonlyArray<QuestionSource>): SourceGroup[] {
  const groups = new Map<string, { fileType: string; pages: number[]; moments: number[] }>();
  for (const source of sources) {
    const group = groups.get(source.fileName) ?? { fileType: source.fileType, pages: [], moments: [] };
    if (source.startMs !== null) group.moments.push(source.startMs);
    else if (source.pageNumber !== null) group.pages.push(source.pageNumber);
    groups.set(source.fileName, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fileName, group]) => ({
      fileName,
      fileType: group.fileType,
      places: [
        ...[...new Set(group.pages)].sort((a, b) => a - b).map((page) => `Page ${page}`),
        ...[...new Set(group.moments)].sort((a, b) => a - b).map(formatMoment),
      ],
    }));
}

// Answers carry <<cite:n>> markers for the student chat's citation chips;
// the analytics page lists sources separately.
export function stripCitationMarkers(text: string): string {
  return text.replace(/[ \t]*<<cite:[\d+]+>>/g, '');
}
