import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), chat: {} as Record<string, unknown>, toastError: vi.fn(),
  useAnalyticsChat: vi.fn((_course: string | null, _start: string | null, _end: string | null) => ({})),
}));
const api = vi.hoisted(() => ({
  fetchQuestionOverview: vi.fn(),
  fetchQuestions: vi.fn(),
  fetchQuestionTerms: vi.fn(),
  fetchCitedMaterials: vi.fn(),
  fetchCitedPlaces: vi.fn(),
  fetchQuestionBuckets: vi.fn(),
  labelQuestions: vi.fn(),
  matchKeyword: vi.fn(),
}));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/analytics-chat/useAnalyticsChat', () => ({
  useAnalyticsChat: (course: string | null, start: string | null, end: string | null) => {
    mocks.useAnalyticsChat(course, start, end);
    return mocks.chat;
  },
}));
vi.mock('@/features/course-analytics/analyticsApi', () => api);
vi.mock('@/features/course-analytics/AskAnalyticsSheet', () => ({
  AskAnalyticsSheet: ({ chat, disabledReason }: { chat: unknown; disabledReason: string | null }) =>
    <button disabled={Boolean(disabledReason)} data-same-chat={String(chat === mocks.chat)}>ask sheet</button>,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
import AdminAnalytics from './AdminAnalytics';
import { NO_FILTERS } from '@/features/course-analytics/questionFilters';

function chain(result: unknown) { const q: Record<string, unknown> = {}; for (const m of ['select', 'order']) q[m] = vi.fn(() => q); q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve); return q; }

const DAY = 24 * 3600 * 1000;
type Range = { startAt: string; endAt: string };
const lastRange = () => api.fetchQuestionOverview.mock.lastCall?.[1] as Range;
const lastFilters = () => api.fetchQuestions.mock.lastCall?.[2];
// fetchQuestions also loads the three needs-attention examples; this finds
// the calls made by the main question list.
const listCalls = () => api.fetchQuestions.mock.calls.filter(([, , , page]) => page.limit !== 3);
const lastListFilters = () => listCalls().at(-1)?.[2];

const OVERVIEW = {
  questionCount: 31, studentCount: 2, labeledCount: 30, answeredFromMaterialsCount: 21,
  needsAttentionCount: 8, citedQuestionCount: 25, documentQuestionCount: 25, videoQuestionCount: 3,
};
const QUESTION = {
  id: 'q1', queryText: 'What is double hashing?', createdAt: '2026-10-17T11:10:35Z', category: 'definition_concept',
  isStudyQuestion: true, answeredFromMaterials: true, needsAttention: false,
  sources: [{ materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null }],
};

describe('AdminAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat = { messages: [], input: '', setInput: vi.fn(), isLoading: false, handleSend: vi.fn(), stopGenerating: vi.fn(), clearChat: vi.fn() };
    mocks.from.mockImplementation(() =>
      chain({ data: [{ id: 'c1', name: 'Algorithms', code: 'CS101' }, { id: 'c2', name: 'Databases', code: null }], error: null }));
    api.fetchQuestionOverview.mockResolvedValue(OVERVIEW);
    api.fetchQuestions.mockImplementation(async (_course, _range, filters, page) => ({
      totalCount: page.limit === 3 ? 8 : 1,
      studentCount: 1,
      questions: page.limit === 3
        ? [{ ...QUESTION, id: 'g1', queryText: 'what is photosynthesis', needsAttention: true, sources: [] }]
        : [{ ...QUESTION, queryText: filters.needsAttention ? 'a gap question' : QUESTION.queryText }],
    }));
    api.fetchQuestionTerms.mockResolvedValue([{ key: 'hash', term: 'hashing', wordCount: 1, questionCount: 8, studentCount: 2 }]);
    api.fetchCitedMaterials.mockResolvedValue([
      { materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', questionCount: 20, studentCount: 2, citationCount: 30, lastCitedAt: null },
    ]);
    api.fetchCitedPlaces.mockResolvedValue([
      { key: 'm1:page:2', materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null, questionCount: 6, citationCount: 9 },
    ]);
    api.fetchQuestionBuckets.mockResolvedValue([
      { category: 'comparison', questionCount: 3, labeledCount: 3, studyQuestionCount: 3, answeredFromMaterialsCount: 3 },
    ]);
    api.labelQuestions.mockResolvedValue({ labeled: 0, failed: 0, remaining: 0 });
  });

  async function renderLoaded() {
    render(<AdminAnalytics />);
    await screen.findByText('What is double hashing?');
  }

  it('leads with questions and loads every view for the first course and the last 30 days', async () => {
    await renderLoaded();
    expect(screen.getByRole('heading', { name: 'Course analytics' })).toBeInTheDocument();

    const range = lastRange();
    expect(new Date(range.endAt).getTime() - new Date(range.startAt).getTime()).toBe(30 * DAY);
    expect(api.fetchQuestionOverview).toHaveBeenLastCalledWith('c1', range);
    expect(lastListFilters()).toEqual(NO_FILTERS);
    expect(api.fetchQuestions).toHaveBeenCalledWith('c1', range, { ...NO_FILTERS, needsAttention: true }, { limit: 3, offset: 0 });
    expect(api.fetchQuestionTerms).toHaveBeenLastCalledWith('c1', range);
    expect(api.fetchCitedMaterials).toHaveBeenLastCalledWith('c1', range);
    expect(api.fetchCitedPlaces).toHaveBeenLastCalledWith('c1', range);
    expect(api.labelQuestions).toHaveBeenCalledWith('c1', range);
    expect(mocks.useAnalyticsChat).toHaveBeenLastCalledWith('c1', range.startAt, range.endAt);

    expect(within(screen.getByRole('group', { name: 'Questions' })).getByText('31')).toBeInTheDocument();
    expect(await screen.findByText('what is photosynthesis')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'hashing, 8 questions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Comparison.*3 questions/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ask sheet' })).toHaveAttribute('data-same-chat', 'true');
  });

  it('filters the questions from every side view, and toggles a filter off', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'hashing, 8 questions' }));
    await waitFor(() => expect(lastListFilters()).toMatchObject({ topic: { text: 'hashing', places: null, source: 'term' } }));
    expect(screen.getByRole('button', { name: 'Remove filter: Mentions “hashing”' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'hashing, 8 questions' }));
    await waitFor(() => expect(lastListFilters()).toEqual(NO_FILTERS));

    fireEvent.click(await screen.findByRole('button', { name: /^Hashing\.pdf.*20 questions/ }));
    await waitFor(() => expect(lastListFilters()).toMatchObject({ material: { id: 'm1', name: 'Hashing.pdf' } }));
    fireEvent.click(screen.getByRole('button', { name: /Videos.*3 questions/ }));
    await waitFor(() => expect(lastListFilters()).toMatchObject({ sourceKind: 'video', material: { id: 'm1' } }));
    fireEvent.click(screen.getByRole('button', { name: /Comparison.*3 questions/ }));
    await waitFor(() => expect(lastListFilters()).toMatchObject({ category: 'comparison' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(lastListFilters()).toEqual(NO_FILTERS));

    fireEvent.click(screen.getByRole('button', { name: /Hashing\.pdf · Page 2.*6 questions/ }));
    await waitFor(() => expect(lastListFilters()).toMatchObject({ place: { filter: { material_id: 'm1', page_number: 2 } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Cited Hashing.pdf · Page 2' }));
    await waitFor(() => expect(lastListFilters()).toEqual(NO_FILTERS));

    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(await screen.findByText('a gap question')).toBeInTheDocument();
    expect(lastFilters()).toMatchObject({ needsAttention: true });
  });

  it('searches a topic in the materials and the questions', async () => {
    api.matchKeyword.mockResolvedValue([
      { key: 'm1:page:2', materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null, similarity: 0.5, snippet: '', chunkCount: 1 },
    ]);
    await renderLoaded();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search questions' }), { target: { value: 'probing' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(lastListFilters()).toMatchObject({
      topic: { text: 'probing', places: [{ material_id: 'm1', page_number: 2 }], source: 'search' },
    }));
    expect(api.matchKeyword).toHaveBeenCalledWith('c1', 'probing');
    expect(screen.getByRole('button', { name: 'Remove filter: About “probing”' })).toBeInTheDocument();
  });

  it('switches presets and validates a custom range', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    await waitFor(() => {
      const range = lastRange();
      expect(new Date(range.endAt).getTime() - new Date(range.startAt).getTime()).toBe(7 * DAY);
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).not.toBe('');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2030-01-02T00:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2030-01-01T00:00' } });
    expect(screen.getByText('Start date and time must be earlier than or equal to the end date and time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ask sheet' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2030-01-03T00:00' } });
    await waitFor(() => expect(lastRange().startAt).toBe(new Date('2030-01-02T00:00').toISOString()));
  });

  it('handles course loading failures and the no-course state', async () => {
    mocks.from.mockImplementation(() => chain({ data: null, error: { message: 'offline' } }));
    render(<AdminAnalytics />);
    expect(await screen.findByText(/No courses yet/)).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith('offline');
    expect(api.fetchQuestions).not.toHaveBeenCalled();
  });
});
