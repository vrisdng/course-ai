import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsQuestion, CitedFile, QuestionDetail, QuestionOverview } from './analyticsApi';
import { NavPane } from './NavPane';
import { QuestionDetailPane } from './QuestionDetailPane';
import { ALL_QUESTIONS } from './questionFilters';
import { QuestionsPane } from './QuestionsPane';
import { QuestionSearch } from './QuestionSearch';
import type { QuestionFeedState } from './useQuestionFeed';
import type { QuestionLabelsState } from './useQuestionLabels';
import type { TopicSearchState } from './useTopicSearch';

const loaded = <T,>(data: T) => ({ data, isLoading: false, error: null });
const loading = { data: null, isLoading: true, error: null };

const OVERVIEW: QuestionOverview = {
  questionCount: 31, studentCount: 2, labeledCount: 30, answeredFromMaterialsCount: 21,
  needsAttentionCount: 8, nonStudyCount: 4, citedQuestionCount: 25, documentQuestionCount: 25, videoQuestionCount: 3,
};
const FILES: CitedFile[] = [{ fileName: 'Hashing.pdf', fileType: 'pdf', materialIds: ['m1', 'm2'], questionCount: 20, studentCount: 2 }];

function labels(overrides: Partial<QuestionLabelsState> = {}): QuestionLabelsState {
  return {
    buckets: [{ category: 'comparison', questionCount: 3, labeledCount: 3, studyQuestionCount: 3, answeredFromMaterialsCount: 3 }],
    isLoadingBuckets: false, bucketError: null, isLabelling: false, remaining: 0, labelError: null, version: 0,
    ...overrides,
  };
}

describe('NavPane', () => {
  it('lists views, files and question types with counts, and picks one', () => {
    const onSelect = vi.fn();
    render(<NavPane overview={loaded(OVERVIEW)} files={loaded(FILES)} labels={labels()} selection={ALL_QUESTIONS} studyOnly={false} onSelect={onSelect} />);

    expect(screen.getByRole('button', { name: 'All questions, 31' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Not from materials, 8' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'attention' });
    expect(screen.queryByText('Topics')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hashing.pdf, 20' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'file', name: 'Hashing.pdf', fileType: 'pdf', ids: ['m1', 'm2'] });
    fireEvent.click(screen.getByRole('button', { name: 'Comparison, 3' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'type', category: 'comparison' });
  });

  it('marks the current selection and shows labelling progress', () => {
    render(<NavPane overview={loaded(OVERVIEW)} files={loaded(FILES)} labels={labels({ isLabelling: true, remaining: 4 })} selection={{ kind: 'type', category: 'comparison' }} studyOnly onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Comparison, 3' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'All questions, 27' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText(/Labelling questions… 4 left/)).toBeInTheDocument();
  });

  it('explains empty sections, loading and errors', () => {
    const { rerender } = render(<NavPane overview={loading} files={loaded([])} labels={labels({ buckets: [] })} selection={ALL_QUESTIONS} studyOnly onSelect={vi.fn()} />);
    expect(screen.getByText('No answers cited your materials.')).toBeInTheDocument();
    rerender(<NavPane overview={loaded(OVERVIEW)} files={{ data: null, isLoading: false, error: 'Access denied' }} labels={labels({ labelError: 'Decisions API error (403)' })} selection={ALL_QUESTIONS} studyOnly onSelect={vi.fn()} />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText(/Some questions couldn't be labelled: Decisions API error \(403\)/)).toBeInTheDocument();
  });
});

const question = (overrides: Partial<AnalyticsQuestion> = {}): AnalyticsQuestion => ({
  id: 'q1', queryText: 'What is double hashing?', createdAt: '2026-10-17T11:10:35Z', category: 'definition_concept',
  isStudyQuestion: true, answeredFromMaterials: true, needsAttention: false, sources: [], ...overrides,
});

function feed(overrides: Partial<QuestionFeedState> = {}): QuestionFeedState {
  return {
    questions: [question(), question({ id: 'q2', queryText: 'what is photosynthesis', needsAttention: true })],
    totalCount: 2, studentCount: 1, isLoading: false, isLoadingMore: false, error: null, hasMore: false, loadMore: vi.fn(),
    ...overrides,
  };
}

function search(overrides: Partial<TopicSearchState> = {}): TopicSearchState {
  return { input: '', setInput: vi.fn(), submit: vi.fn(), isMatching: false, note: null, mode: 'both', setMode: vi.fn(), ...overrides };
}

describe('QuestionsPane', () => {
  const props = {
    title: 'All questions', studyOnly: true, onStudyOnlyChange: vi.fn(), selectedId: 'q1', onSelectQuestion: vi.fn(),
  };

  it('lists questions compactly, marks gaps and the open question, and opens one', () => {
    const onSelectQuestion = vi.fn();
    render(<QuestionsPane {...props} feed={feed()} onSelectQuestion={onSelectQuestion} />);
    expect(screen.getByRole('heading', { name: 'All questions' })).toBeInTheDocument();
    expect(screen.getByText('2 questions · 1 student')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /What is double hashing\?/ })).toHaveAttribute('aria-current', 'true');
    const gap = screen.getByRole('button', { name: /what is photosynthesis/ });
    expect(within(gap).getByText('Not from materials')).toBeInTheDocument();
    fireEvent.click(gap);
    expect(onSelectQuestion).toHaveBeenCalledWith('q2');
  });

  it('toggles greetings and logistics', () => {
    const onStudyOnlyChange = vi.fn();
    render(<QuestionsPane {...props} feed={feed()} onStudyOnlyChange={onStudyOnlyChange} />);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide greetings and logistics' }));
    expect(onStudyOnlyChange).toHaveBeenCalledWith(false);
  });

  it('loads more and explains empty, loading and error states', () => {
    const loadMore = vi.fn();
    const { rerender } = render(<QuestionsPane {...props} feed={feed({ hasMore: true, totalCount: 40, loadMore })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(loadMore).toHaveBeenCalled();
    rerender(<QuestionsPane {...props} feed={feed({ questions: [], totalCount: 0 })} />);
    expect(screen.getByText('No questions here.')).toBeInTheDocument();
    rerender(<QuestionsPane {...props} feed={feed({ questions: [], isLoading: true })} />);
    expect(screen.getByLabelText('Loading questions')).toBeInTheDocument();
    rerender(<QuestionsPane {...props} feed={feed({ questions: [], error: 'Access denied' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });

  it('offers a way back on small screens', () => {
    const onBack = vi.fn();
    render(<QuestionsPane {...props} feed={feed()} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to views' }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('QuestionSearch', () => {
  it('searches all questions and shows why a search fell back to text', () => {
    const setInput = vi.fn();
    const submit = vi.fn();
    render(<QuestionSearch search={search({ setInput, submit, note: 'Materials search failed.' })} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all questions' }), { target: { value: 'probing' } });
    expect(setInput).toHaveBeenCalledWith('probing');
    fireEvent.submit(screen.getByRole('search'));
    expect(submit).toHaveBeenCalled();
    expect(screen.getByText('Materials search failed.')).toBeInTheDocument();
  });

  it('chooses where to search', () => {
    const setMode = vi.fn();
    render(<QuestionSearch search={search({ setMode })} />);
    const group = screen.getByRole('radiogroup', { name: 'Search in' });
    expect(within(group).getByRole('radio', { name: 'Both' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(group).getByRole('radio', { name: 'Text' }));
    expect(setMode).toHaveBeenCalledWith('questions');
    fireEvent.click(within(group).getByRole('radio', { name: 'Citations' }));
    expect(setMode).toHaveBeenCalledWith('materials');
  });

  it('shows a spinner while matching the materials', () => {
    render(<QuestionSearch search={search({ input: 'probing', isMatching: true })} />);
    expect(screen.getByLabelText('Searching')).toBeInTheDocument();
  });
});

describe('QuestionDetailPane', () => {
  const detail: QuestionDetail = {
    ...question({ id: 'q1' }),
    sources: [
      { materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null },
      { materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 1, startMs: null, endMs: null },
    ],
    answerText: 'Double hashing uses **a second hash**. <<cite:1>>',
    relatedCount: 3,
    related: [{ id: 'q9', queryText: 'when is double hashing used', createdAt: '2026-10-09T14:41:00Z', needsAttention: false }],
  };

  it('shows the question, the answer it got, what it cited and related questions', () => {
    const onSelectQuestion = vi.fn();
    render(<QuestionDetailPane detail={loaded(detail)} hasSelection onSelectQuestion={onSelectQuestion} />);
    expect(screen.getByRole('heading', { name: 'What is double hashing?' })).toBeInTheDocument();
    expect(screen.getByText('Answered from the materials')).toBeInTheDocument();
    expect(screen.getByText('a second hash')).toBeInTheDocument();
    expect(screen.queryByText(/<<cite/)).not.toBeInTheDocument();
    expect(screen.getByText('Hashing.pdf')).toBeInTheDocument();
    expect(screen.getByText('Page 1, Page 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /when is double hashing used/ }));
    expect(onSelectQuestion).toHaveBeenCalledWith('q9');
    expect(screen.getByText('and 2 more')).toBeInTheDocument();
  });

  it('flags an answer that did not come from the materials', () => {
    render(<QuestionDetailPane detail={loaded({ ...detail, needsAttention: true, answeredFromMaterials: false, sources: [], relatedCount: 0, related: [] })} hasSelection onSelectQuestion={vi.fn()} />);
    expect(screen.getByText('Not answered from the materials')).toBeInTheDocument();
    expect(screen.getByText('The answer cited nothing.')).toBeInTheDocument();
    expect(screen.getByText('No other questions on the same subject.')).toBeInTheDocument();
  });

  it('explains no selection, a missing question, loading and errors', () => {
    const { rerender } = render(<QuestionDetailPane detail={loaded(null)} hasSelection={false} onSelectQuestion={vi.fn()} />);
    expect(screen.getByText('Pick a question to see the answer it got.')).toBeInTheDocument();
    rerender(<QuestionDetailPane detail={loaded(null)} hasSelection onSelectQuestion={vi.fn()} />);
    expect(screen.getByText("This question isn't in the selected dates.")).toBeInTheDocument();
    rerender(<QuestionDetailPane detail={loading} hasSelection onSelectQuestion={vi.fn()} />);
    expect(screen.getByLabelText('Loading question')).toBeInTheDocument();
    rerender(<QuestionDetailPane detail={{ data: null, isLoading: false, error: 'Access denied' }} hasSelection onSelectQuestion={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });

  it('offers a way back on small screens', () => {
    const onBack = vi.fn();
    render(<QuestionDetailPane detail={loaded(detail)} hasSelection onSelectQuestion={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to questions' }));
    expect(onBack).toHaveBeenCalled();
  });
});
