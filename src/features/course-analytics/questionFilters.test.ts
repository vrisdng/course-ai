import { describe, expect, it } from 'vitest';

import {
  NO_FILTERS,
  activeFilters,
  hasFilters,
  sourceLabel,
  sourceToPlace,
  toQuestionArgs,
  withoutFilter,
  type QuestionFilters,
} from './questionFilters';

const page = { materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null };
const moment = { materialId: 'v1', fileName: 'Lecture 4.mp4', fileType: 'video', pageNumber: null, startMs: 65000, endMs: null };

const ALL: QuestionFilters = {
  topic: { text: 'hash table', places: [{ material_id: 'm1', page_number: 2 }], source: 'search' },
  material: { id: 'm1', name: 'Hashing.pdf' },
  place: { key: 'm1:page:2', label: 'Hashing.pdf · Page 2', filter: { material_id: 'm1', page_number: 2 } },
  sourceKind: 'video',
  category: 'comparison',
  needsAttention: true,
};

describe('toQuestionArgs', () => {
  it('sends nothing for no filters', () => {
    expect(toQuestionArgs(NO_FILTERS)).toEqual({
      in_topic_text: null,
      in_topic_places: null,
      in_places: null,
      in_material_id: null,
      in_source_kind: null,
      in_category: null,
      in_needs_attention: false,
    });
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it('maps every filter to its RPC argument', () => {
    expect(toQuestionArgs(ALL)).toEqual({
      in_topic_text: 'hash table',
      in_topic_places: [{ material_id: 'm1', page_number: 2 }],
      in_places: [{ material_id: 'm1', page_number: 2 }],
      in_material_id: 'm1',
      in_source_kind: 'video',
      in_category: 'comparison',
      in_needs_attention: true,
    });
    expect(hasFilters(ALL)).toBe(true);
  });

  it('sends no topic places for a term picked from the list', () => {
    const filters = { ...NO_FILTERS, topic: { text: 'hashing', places: null, source: 'term' as const } };
    expect(toQuestionArgs(filters).in_topic_places).toBeNull();
  });
});

describe('activeFilters', () => {
  it('names each filter in plain words', () => {
    expect(activeFilters(ALL).map((filter) => filter.label)).toEqual([
      'About “hash table”',
      'Needs attention',
      'Cited Hashing.pdf',
      'Cited Hashing.pdf · Page 2',
      'Cited a video',
      'Comparison',
    ]);
    const term = { ...NO_FILTERS, topic: { text: 'hashing', places: null, source: 'term' as const } };
    expect(activeFilters(term)[0].label).toBe('Mentions “hashing”');
    expect(activeFilters({ ...NO_FILTERS, sourceKind: 'document' })[0].label).toBe('Cited a document');
  });

  it('removes one filter at a time', () => {
    const next = withoutFilter(ALL, 'material');
    expect(next.material).toBeNull();
    expect(next.topic).toBe(ALL.topic);
    expect(withoutFilter(ALL, 'needsAttention').needsAttention).toBe(false);
  });
});

describe('sources', () => {
  it('labels a page or a video moment', () => {
    expect(sourceLabel(page)).toBe('Hashing.pdf · Page 2');
    expect(sourceLabel(moment)).toBe('Lecture 4.mp4 · 1:05');
    expect(sourceLabel({ ...page, pageNumber: null })).toBe('Hashing.pdf');
  });

  it('turns a source into the place filter that finds it', () => {
    expect(sourceToPlace(page)).toEqual({
      key: 'm1:page:2', label: 'Hashing.pdf · Page 2', filter: { material_id: 'm1', page_number: 2 },
    });
    expect(sourceToPlace({ ...moment, endMs: 80000 }).filter).toEqual({ material_id: 'v1', start_ms: 65000, end_ms: 80000 });
    expect(sourceToPlace(moment).filter).toEqual({ material_id: 'v1', start_ms: 65000, end_ms: 65000 });
  });
});
