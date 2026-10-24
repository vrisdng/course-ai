import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsQuestion, CitedMaterial, CitedPlace, QuestionOverview } from './analyticsApi';
import { CitedFilesCard } from './CitedFilesCard';
import { NeedsAttentionCard } from './NeedsAttentionCard';
import { OverviewNumbers } from './OverviewNumbers';
import { NO_FILTERS } from './questionFilters';
import { QuestionBucketsPanel } from './QuestionBucketsPanel';
import { QuestionList } from './QuestionList';
import type { QuestionTerm } from './questionTerms';
import { TopicsCard } from './TopicsCard';
import type { QuestionFeedState } from './useQuestionFeed';
import type { QuestionLabelsState } from './useQuestionLabels';
import type { TopicSearchState } from './useTopicSearch';

const loaded = <T,>(data: T) => ({ data, isLoading: false, error: null });
const loading = { data: null, isLoading: true, error: null };

const OVERVIEW: QuestionOverview = {
  questionCount: 31, studentCount: 2, labeledCount: 30, answeredFromMaterialsCount: 21,
  needsAttentionCount: 8, citedQuestionCount: 25, documentQuestionCount: 25, videoQuestionCount: 3,
};

const question = (overrides: Partial<AnalyticsQuestion> = {}): AnalyticsQuestion => ({
  id: 'q1',
  queryText: 'What is double hashing?',
  createdAt: '2026-10-17T11:10:35Z',
  category: 'definition_concept',
  isStudyQuestion: true,
  answeredFromMaterials: true,
  needsAttention: false,
  sources: [
    { materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null },
    { materialId: 'v1', fileName: 'Lecture 4.mp4', fileType: 'video', pageNumber: null, startMs: 65000, endMs: 80000 },
  ],
  ...overrides,
});

describe('OverviewNumbers', () => {
  it('shows questions, students, answered share and what needs attention', () => {
    const onShowNeedsAttention = vi.fn();
    render(<OverviewNumbers overview={loaded(OVERVIEW)} onShowNeedsAttention={onShowNeedsAttention} />);
    expect(within(screen.getByRole('group', { name: 'Questions' })).getByText('31')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Students asking' })).getByText('2')).toBeInTheDocument();
    const answered = screen.getByRole('group', { name: 'Answered from materials' });
    expect(within(answered).getByText('70%')).toBeInTheDocument();
    expect(within(answered).getByText('21 of 30 labelled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /8 need attention/ }));
    expect(onShowNeedsAttention).toHaveBeenCalled();
  });

  it('shows dashes while loading or with nothing labelled, and errors', () => {
    const { rerender } = render(<OverviewNumbers overview={loading} onShowNeedsAttention={vi.fn()} />);
    expect(screen.getAllByLabelText('Loading')).toHaveLength(4);
    rerender(<OverviewNumbers overview={loaded({ ...OVERVIEW, labeledCount: 0, needsAttentionCount: 0 })} onShowNeedsAttention={vi.fn()} />);
    expect(within(screen.getByRole('group', { name: 'Answered from materials' })).getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /need attention/ })).not.toBeInTheDocument();
    rerender(<OverviewNumbers overview={{ data: null, isLoading: false, error: 'Access denied' }} onShowNeedsAttention={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });
});

describe('NeedsAttentionCard', () => {
  const place: CitedPlace = {
    key: 'm1:page:2', materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf',
    pageNumber: 2, startMs: null, endMs: null, questionCount: 6, citationCount: 9,
  };

  it('shows example gaps and the most-asked places, and filters on click', () => {
    const onShowNeedsAttention = vi.fn();
    const onSelectPlace = vi.fn();
    render(
      <NeedsAttentionCard
        count={8}
        examples={loaded([question({ id: 'g1', queryText: 'what is photosynthesis', needsAttention: true, sources: [] })])}
        places={loaded([place])}
        onShowNeedsAttention={onShowNeedsAttention}
        onSelectPlace={onSelectPlace}
      />,
    );
    expect(screen.getByText('what is photosynthesis')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(onShowNeedsAttention).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Hashing\.pdf · Page 2.*6 questions/ }));
    expect(onSelectPlace).toHaveBeenCalledWith({
      key: 'm1:page:2', label: 'Hashing.pdf · Page 2', filter: { material_id: 'm1', page_number: 2 },
    });
  });

  it('says when nothing needs attention', () => {
    render(<NeedsAttentionCard count={0} examples={loaded([])} places={loaded([])} onShowNeedsAttention={vi.fn()} onSelectPlace={vi.fn()} />);
    expect(screen.getByText(/Every study question was answered from your materials/)).toBeInTheDocument();
    expect(screen.getByText(/No answers cited the materials/)).toBeInTheDocument();
  });
});

function feed(overrides: Partial<QuestionFeedState> = {}): QuestionFeedState {
  return {
    questions: [question()], totalCount: 1, studentCount: 1, isLoading: false, isLoadingMore: false,
    error: null, hasMore: false, loadMore: vi.fn(), ...overrides,
  };
}

function search(overrides: Partial<TopicSearchState> = {}): TopicSearchState {
  return { input: '', setInput: vi.fn(), submit: vi.fn(), isMatching: false, note: null, ...overrides };
}

describe('QuestionList', () => {
  it('lists questions with their type and cited sources, which filter on click', () => {
    const onSelectPlace = vi.fn();
    render(<QuestionList feed={feed()} search={search()} filters={NO_FILTERS} onRemoveFilter={vi.fn()} onClearFilters={vi.fn()} onSelectPlace={onSelectPlace} />);
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('What is double hashing?')).toBeInTheDocument();
    expect(within(item).getByText('Concept or definition')).toBeInTheDocument();
    expect(screen.getByText('1 question from 1 student')).toBeInTheDocument();
    fireEvent.click(within(item).getByRole('button', { name: /Lecture 4\.mp4 · 1:05/ }));
    expect(onSelectPlace).toHaveBeenCalledWith(expect.objectContaining({ filter: { material_id: 'v1', start_ms: 65000, end_ms: 80000 } }));
  });

  it('marks questions that need attention and caps the source tags', () => {
    const sources = [1, 2, 3, 4, 5].map((page) => ({ materialId: 'm1', fileName: 'A.pdf', fileType: 'pdf', pageNumber: page, startMs: null, endMs: null }));
    render(<QuestionList feed={feed({ questions: [question({ needsAttention: true, sources })] })} search={search()} filters={NO_FILTERS} onRemoveFilter={vi.fn()} onClearFilters={vi.fn()} onSelectPlace={vi.fn()} />);
    expect(screen.getByText('Not answered from materials')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /A\.pdf · Page/ })).toHaveLength(3);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('searches, shows active filters and removes them', () => {
    const setInput = vi.fn();
    const submit = vi.fn();
    const onRemoveFilter = vi.fn();
    const onClearFilters = vi.fn();
    const filters = { ...NO_FILTERS, needsAttention: true, category: 'comparison' };
    render(<QuestionList feed={feed()} search={search({ input: 'hash', setInput, submit })} filters={filters} onRemoveFilter={onRemoveFilter} onClearFilters={onClearFilters} onSelectPlace={vi.fn()} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search questions' }), { target: { value: 'hashing' } });
    expect(setInput).toHaveBeenCalledWith('hashing');
    fireEvent.submit(screen.getByRole('search'));
    expect(submit).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Needs attention' }));
    expect(onRemoveFilter).toHaveBeenCalledWith('needsAttention');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('loads more, and explains empty, loading and error states', () => {
    const loadMore = vi.fn();
    const { rerender } = render(<QuestionList feed={feed({ hasMore: true, totalCount: 30, loadMore })} search={search()} filters={NO_FILTERS} onRemoveFilter={vi.fn()} onClearFilters={vi.fn()} onSelectPlace={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show more questions' }));
    expect(loadMore).toHaveBeenCalled();

    rerender(<QuestionList feed={feed({ questions: [], totalCount: 0 })} search={search()} filters={{ ...NO_FILTERS, needsAttention: true }} onRemoveFilter={vi.fn()} onClearFilters={vi.fn()} onSelectPlace={vi.fn()} />);
    expect(screen.getByText('No questions match these filters.')).toBeInTheDocument();
    rerender(<QuestionList feed={feed({ questions: [], totalCount: 0 })} search={search()} filters={NO_FILTERS} onRemoveFilter={vi.fn()} onClearFilters={vi.fn()} onSelectPlace={vi.fn()} />);
    expect(screen.getByText('No questions in these dates.')).toBeInTheDocument();
    rerender(<QuestionList feed={feed({ questions: [], isLoading: true })} search={search()} filters={NO_FILTERS} onRemoveFilter={vi.fn()} onClearFilters={vi.fn()} onSelectPlace={vi.fn()} />);
    expect(screen.getByLabelText('Loading questions')).toBeInTheDocument();
    rerender(<QuestionList feed={feed({ error: 'Access denied' })} search={search({ note: 'Showing questions that mention it.' })} filters={NO_FILTERS} onRemoveFilter={vi.fn()} onClearFilters={vi.fn()} onSelectPlace={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.getByText('Showing questions that mention it.')).toBeInTheDocument();
  });
});

describe('TopicsCard', () => {
  const terms: QuestionTerm[] = [
    { key: 'hash', term: 'hashing', wordCount: 1, questionCount: 8, studentCount: 2 },
    { key: 'doubl hash', term: 'double hashing', wordCount: 2, questionCount: 4, studentCount: 2 },
  ];

  it('lists terms with counts and picks one', () => {
    const onSelect = vi.fn();
    render(<TopicsCard terms={loaded(terms)} selected="hashing" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'hashing, 8 questions' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'double hashing, 4 questions' }));
    expect(onSelect).toHaveBeenCalledWith('double hashing');
  });

  it('says when no topic repeats yet', () => {
    render(<TopicsCard terms={loaded([])} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/No topic came up in more than one question/)).toBeInTheDocument();
  });
});

describe('CitedFilesCard', () => {
  const files: CitedMaterial[] = [
    { materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', questionCount: 20, studentCount: 2, citationCount: 30, lastCitedAt: null },
    { materialId: 'v1', fileName: 'Lecture 4.mp4', fileType: 'video', questionCount: 3, studentCount: 1, citationCount: 3, lastCitedAt: null },
  ];

  it('splits answers by documents and videos, ranks files and filters on click', () => {
    const onSelectFile = vi.fn();
    const onSelectSourceKind = vi.fn();
    render(
      <CitedFilesCard
        files={loaded(files)}
        overview={OVERVIEW}
        selectedFileId="m1"
        selectedSourceKind={null}
        onSelectFile={onSelectFile}
        onSelectSourceKind={onSelectSourceKind}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Documents.*25 questions/ }));
    expect(onSelectSourceKind).toHaveBeenCalledWith('document');
    fireEvent.click(screen.getByRole('button', { name: /Videos.*3 questions/ }));
    expect(onSelectSourceKind).toHaveBeenCalledWith('video');

    expect(screen.getByRole('button', { name: /Hashing\.pdf.*20 questions/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Lecture 4\.mp4.*3 questions/ }));
    expect(onSelectFile).toHaveBeenCalledWith({ id: 'v1', name: 'Lecture 4.mp4' });
  });

  it('shows only the top files until asked for all', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...files[0], materialId: `m${index}`, fileName: `File ${index}.pdf`, questionCount: 10 - index }));
    render(<CitedFilesCard files={loaded(many)} overview={OVERVIEW} selectedFileId={null} selectedSourceKind={null} onSelectFile={vi.fn()} onSelectSourceKind={vi.fn()} />);
    expect(screen.queryByText('File 8.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 9 files' }));
    expect(screen.getByText('File 8.pdf')).toBeInTheDocument();
  });

  it('says when no answer cited a file', () => {
    render(<CitedFilesCard files={loaded([])} overview={{ ...OVERVIEW, citedQuestionCount: 0 }} selectedFileId={null} selectedSourceKind={null} onSelectFile={vi.fn()} onSelectSourceKind={vi.fn()} />);
    expect(screen.getByText('No answers cited your materials in these dates.')).toBeInTheDocument();
  });
});

describe('QuestionBucketsPanel', () => {
  const state = (overrides: Partial<QuestionLabelsState> = {}): QuestionLabelsState => ({
    buckets: [
      { category: 'definition_concept', questionCount: 12, labeledCount: 12, studyQuestionCount: 12, answeredFromMaterialsCount: 9 },
      { category: 'comparison', questionCount: 3, labeledCount: 2, studyQuestionCount: 2, answeredFromMaterialsCount: 2 },
    ],
    isLoadingBuckets: false, bucketError: null, isLabelling: false, remaining: 0, labelError: null, version: 0,
    ...overrides,
  });

  it('lists question types and picks one', () => {
    const onSelect = vi.fn();
    render(<QuestionBucketsPanel state={state()} selected="comparison" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /Comparison.*3 questions/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Concept or definition.*12 questions/ }));
    expect(onSelect).toHaveBeenCalledWith('definition_concept');
  });

  it('shows labelling progress, errors and what is still unlabelled', () => {
    const { rerender } = render(<QuestionBucketsPanel state={state({ isLabelling: true, remaining: 5 })} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/Labelling questions… 5 left/)).toBeInTheDocument();
    rerender(<QuestionBucketsPanel state={state({ labelError: 'Decisions API error (403)', remaining: 3 })} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Decisions API error (403)');
    expect(screen.getByText(/3 questions aren't labelled yet/)).toBeInTheDocument();
    rerender(<QuestionBucketsPanel state={state({ buckets: [] })} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText('No questions in these dates.')).toBeInTheDocument();
  });
});
