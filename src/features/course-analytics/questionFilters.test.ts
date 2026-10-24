import { describe, expect, it } from 'vitest';

import {
  ALL_QUESTIONS,
  filtersFor,
  groupSourcesByFile,
  isSameSelection,
  selectionTitle,
  stripCitationMarkers,
  toQuestionArgs,
  type Selection,
} from './questionFilters';

describe('filtersFor', () => {
  it('turns each selection into question filters', () => {
    expect(toQuestionArgs(filtersFor(ALL_QUESTIONS, true))).toEqual({
      in_topic_text: null,
      in_topic_places: null,
      in_places: null,
      in_material_ids: null,
      in_source_kind: null,
      in_category: null,
      in_needs_attention: false,
      in_study_only: true,
    });
    expect(filtersFor({ kind: 'attention' }, false)).toMatchObject({ needsAttention: true, studyOnly: false });
    expect(filtersFor({ kind: 'search', text: 'probing', places: [{ material_id: 'm1', page_number: 2 }] }, true))
      .toMatchObject({ topicText: 'probing', topicPlaces: [{ material_id: 'm1', page_number: 2 }] });
    expect(filtersFor({ kind: 'file', name: 'A.pdf', fileType: 'pdf', ids: ['m1', 'm2'] }, true)).toMatchObject({ materialIds: ['m1', 'm2'] });
    expect(filtersFor({ kind: 'type', category: 'comparison' }, true)).toMatchObject({ category: 'comparison' });
  });
});

describe('selections', () => {
  const file: Selection = { kind: 'file', name: 'A.pdf', fileType: 'pdf', ids: ['m1'] };

  it('names each selection', () => {
    expect(selectionTitle(ALL_QUESTIONS)).toBe('All questions');
    expect(selectionTitle({ kind: 'attention' })).toBe('Not answered from materials');
    expect(selectionTitle({ kind: 'search', text: 'probing', places: null })).toBe('About “probing”');
    expect(selectionTitle(file)).toBe('Cited A.pdf');
    expect(selectionTitle({ kind: 'type', category: 'comparison' })).toBe('Comparison');
  });

  it('compares selections by what they pick', () => {
    expect(isSameSelection(file, { ...file, ids: ['m1'] })).toBe(true);
    expect(isSameSelection(file, { ...file, name: 'B.pdf' })).toBe(false);
    expect(isSameSelection({ kind: 'search', text: 'a', places: null }, { kind: 'search', text: 'a', places: [] })).toBe(true);
    expect(isSameSelection({ kind: 'type', category: 'a' }, { kind: 'search', text: 'a', places: null })).toBe(false);
  });
});

describe('answers', () => {
  it('removes citation markers', () => {
    expect(stripCitationMarkers('Load factor matters. <<cite:1>> <<cite:2+3>>\nNext line<<cite:4>>.')).toBe('Load factor matters.\nNext line.');
  });

  it('groups sources by file with readable places', () => {
    expect(groupSourcesByFile([
      { materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null },
      { materialId: 'v1', fileName: 'Lecture 4.mp4', fileType: 'video', pageNumber: null, startMs: 65000, endMs: 80000 },
      { materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 1, startMs: null, endMs: null },
      { materialId: 'n1', fileName: 'Notes.docx', fileType: 'notes', pageNumber: null, startMs: null, endMs: null },
    ])).toEqual([
      { fileName: 'Hashing.pdf', fileType: 'pdf', places: ['Page 1', 'Page 2'] },
      { fileName: 'Lecture 4.mp4', fileType: 'video', places: ['1:05'] },
      { fileName: 'Notes.docx', fileType: 'notes', places: [] },
    ]);
  });
});
