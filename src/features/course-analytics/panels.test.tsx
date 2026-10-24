import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CitedMaterialsPanel } from './CitedMaterialsPanel';
import { KeywordResults } from './KeywordResults';
import { QuestionBucketsPanel } from './QuestionBucketsPanel';
import { categoryLabel } from './questionCategories';
import type { CitedMaterialsState } from './useCitedMaterials';
import type { KeywordSearchState } from './useKeywordSearch';
import type { QuestionLabelsState } from './useQuestionLabels';

const materials = [
  { materialId: 'm1', fileName: 'Recursion.pdf', fileType: 'pdf', questionCount: 6, studentCount: 4, citationCount: 9, lastCitedAt: null },
  { materialId: 'v1', fileName: 'Lecture 3.mp4', fileType: 'video', questionCount: 3, studentCount: 1, citationCount: 3, lastCitedAt: null },
];

function materialsState(overrides: Partial<CitedMaterialsState> = {}): CitedMaterialsState {
  return { materials, isLoading: false, error: null, expanded: {}, toggleMaterial: vi.fn(), ...overrides };
}

describe('CitedMaterialsPanel', () => {
  it('lists cited materials with question and student counts', () => {
    render(<CitedMaterialsPanel state={materialsState()} />);
    const first = screen.getByRole('button', { name: /Recursion\.pdf/ });
    expect(within(first).getByText('6 questions')).toBeInTheDocument();
    expect(within(first).getByText('4 students')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lecture 3\.mp4/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands a material into its cited pages and video moments', () => {
    const toggleMaterial = vi.fn();
    const state = materialsState({
      toggleMaterial,
      expanded: {
        v1: {
          isLoading: false,
          error: null,
          places: [{ key: 'v1:time:0-300000', materialId: 'v1', fileName: 'Lecture 3.mp4', fileType: 'video', pageNumber: null, startMs: 0, endMs: 300000, questionCount: 2, citationCount: 2 }],
        },
      },
    });
    render(<CitedMaterialsPanel state={state} />);
    fireEvent.click(screen.getByRole('button', { name: /Recursion\.pdf/ }));
    expect(toggleMaterial).toHaveBeenCalledWith('m1');
    expect(screen.getByRole('button', { name: /Lecture 3\.mp4/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('0:00–5:00')).toBeInTheDocument();
    expect(screen.getByText('2 questions')).toBeInTheDocument();
  });

  it('explains empty, loading and error states', () => {
    const { rerender } = render(<CitedMaterialsPanel state={materialsState({ materials: [] })} />);
    expect(screen.getByText(/No answers cited course materials/)).toBeInTheDocument();
    rerender(<CitedMaterialsPanel state={materialsState({ materials: [], isLoading: true })} />);
    expect(screen.getByLabelText('Loading cited materials')).toBeInTheDocument();
    rerender(<CitedMaterialsPanel state={materialsState({ error: 'Access denied' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });
});

const places = [
  { key: 'm1:page:3', materialId: 'm1', fileName: 'Recursion.pdf', fileType: 'pdf', pageNumber: 3, startMs: null, endMs: null, similarity: 0.62, snippet: 'A function that calls itself', chunkCount: 2 },
  { key: 'v1:time:60000-90000', materialId: 'v1', fileName: 'Lecture 3.mp4', fileType: 'video', pageNumber: null, startMs: 60000, endMs: 90000, similarity: 0.41, snippet: 'trace the stack', chunkCount: 1 },
];

function keywordState(overrides: Partial<KeywordSearchState> = {}): KeywordSearchState {
  return {
    keyword: 'recursion', setKeyword: vi.fn(), search: vi.fn().mockResolvedValue(undefined), clear: vi.fn(),
    searchedKeyword: 'recursion', places, isSearching: false, searchError: null,
    selectedKeys: new Set(['m1:page:3']), togglePlace: vi.fn(),
    result: {
      questionCount: 5, studentCount: 3,
      questions: [{ id: 'q1', queryText: 'what is a base case', createdAt: '2026-10-02T10:00:00Z', category: 'definition_concept' }],
    },
    isCounting: false, countError: null, ...overrides,
  };
}

describe('KeywordResults', () => {
  it('renders nothing before a search', () => {
    const { container } = render(<KeywordResults state={keywordState({ searchedKeyword: null, places: [], result: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count, the matched places to untick and the questions', () => {
    const state = keywordState();
    render(<KeywordResults state={state} />);
    expect(screen.getByText(/5 questions/)).toBeInTheDocument();
    expect(screen.getByText(/from 3 students/)).toBeInTheDocument();

    const page = screen.getByRole('checkbox', { name: /Recursion\.pdf.*Page 3/ });
    const moment = screen.getByRole('checkbox', { name: /Lecture 3\.mp4.*1:00–1:30/ });
    expect(page).toBeChecked();
    expect(moment).not.toBeChecked();
    fireEvent.click(moment);
    expect(state.togglePlace).toHaveBeenCalledWith('v1:time:60000-90000');

    expect(screen.getByText('what is a base case')).toBeInTheDocument();
    expect(screen.getByText(categoryLabel('definition_concept'))).toBeInTheDocument();
    expect(screen.getByText(/isn't always what the student asked about/)).toBeInTheDocument();
  });

  it('says when nothing matched, and shows errors', () => {
    const { rerender } = render(<KeywordResults state={keywordState({ places: [], result: null })} />);
    expect(screen.getByText(/Nothing in this course's materials matched "recursion"/)).toBeInTheDocument();
    rerender(<KeywordResults state={keywordState({ searchError: 'keyword is required' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('keyword is required');
  });
});

function labelsState(overrides: Partial<QuestionLabelsState> = {}): QuestionLabelsState {
  return {
    buckets: [
      { category: 'definition_concept', questionCount: 6, labeledCount: 6, studyQuestionCount: 6, answeredFromMaterialsCount: 5 },
      { category: 'other', questionCount: 4, labeledCount: 3, studyQuestionCount: 0, answeredFromMaterialsCount: 0 },
    ],
    isLoadingBuckets: false, bucketError: null, isLabelling: false, remaining: 1, labelError: null, ...overrides,
  };
}

describe('QuestionBucketsPanel', () => {
  it('shows each bucket and the labelled totals', () => {
    render(<QuestionBucketsPanel state={labelsState()} />);
    expect(screen.getByText(categoryLabel('definition_concept'))).toBeInTheDocument();
    expect(screen.getByText(categoryLabel('other'))).toBeInTheDocument();
    expect(screen.getByText(/6 of 9 labelled questions were study questions/)).toBeInTheDocument();
    expect(screen.getByText(/5 were answered from the course materials/)).toBeInTheDocument();
    expect(screen.getByText(/1 question isn't labelled yet/)).toBeInTheDocument();
  });

  it('shows labelling progress and errors', () => {
    const { rerender } = render(<QuestionBucketsPanel state={labelsState({ isLabelling: true, remaining: 30 })} />);
    expect(screen.getByText(/Labelling questions… 30 left/)).toBeInTheDocument();
    rerender(<QuestionBucketsPanel state={labelsState({ labelError: 'Decisions API error (403)' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Decisions API error (403)');
  });

  it('handles no questions', () => {
    render(<QuestionBucketsPanel state={labelsState({ buckets: [], remaining: 0 })} />);
    expect(screen.getByText(/No questions in this window/)).toBeInTheDocument();
  });
});
