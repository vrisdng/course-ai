import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), chat: {} as Record<string, unknown>, toastError: vi.fn(),
  useAnalyticsChat: vi.fn((_course: string | null, _start: string | null, _end: string | null) => ({})),
}));
const api = vi.hoisted(() => ({
  fetchQuestionOverview: vi.fn(),
  fetchQuestions: vi.fn(),
  fetchQuestionDetail: vi.fn(),
  fetchCitedFiles: vi.fn(),
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

function chain(result: unknown) { const q: Record<string, unknown> = {}; for (const m of ['select', 'order']) q[m] = vi.fn(() => q); q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve); return q; }

const DAY = 24 * 3600 * 1000;
type Range = { startAt: string; endAt: string };
const lastRange = () => api.fetchQuestionOverview.mock.lastCall?.[1] as Range;
const lastFilters = () => api.fetchQuestions.mock.lastCall?.[2];

const OVERVIEW = {
  questionCount: 31, studentCount: 2, labeledCount: 30, answeredFromMaterialsCount: 21,
  needsAttentionCount: 8, nonStudyCount: 4, citedQuestionCount: 25, documentQuestionCount: 25, videoQuestionCount: 3,
};
const question = (id: string, queryText: string) => ({
  id, queryText, createdAt: '2026-10-17T11:10:35Z', category: 'definition_concept',
  isStudyQuestion: true, answeredFromMaterials: true, needsAttention: false, sources: [],
});

describe('AdminAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat = { messages: [], input: '', setInput: vi.fn(), isLoading: false, handleSend: vi.fn(), stopGenerating: vi.fn(), clearChat: vi.fn() };
    mocks.from.mockImplementation(() =>
      chain({ data: [{ id: 'c1', name: 'Algorithms', code: 'CS101' }, { id: 'c2', name: 'Databases', code: null }], error: null }));
    api.fetchQuestionOverview.mockResolvedValue(OVERVIEW);
    api.fetchQuestions.mockImplementation(async (_course, _range, filters) => ({
      totalCount: 2,
      studentCount: 1,
      questions: filters.needsAttention
        ? [question('g1', 'what is photosynthesis')]
        : [question('q1', 'What is double hashing?'), question('q2', 'when is double hashing used')],
    }));
    api.fetchQuestionDetail.mockImplementation(async (_course, _range, id) => ({
      ...question(id, id === 'q9' ? 'a related question' : `question ${id}`),
      answerText: `Answer for ${id}`, relatedCount: 1,
      related: [{ id: 'q9', queryText: 'a related question', createdAt: '2026-10-09T00:00:00Z', needsAttention: false }],
    }));
    api.fetchCitedFiles.mockResolvedValue([{ fileName: 'Hashing.pdf', fileType: 'pdf', materialIds: ['m1', 'm2'], questionCount: 20, studentCount: 2 }]);
    api.fetchQuestionBuckets.mockResolvedValue([
      { category: 'comparison', questionCount: 3, labeledCount: 3, studyQuestionCount: 3, answeredFromMaterialsCount: 3 },
    ]);
    api.labelQuestions.mockResolvedValue({ labeled: 0, failed: 0, remaining: 0 });
  });

  async function renderLoaded() {
    render(<AdminAnalytics />);
    await screen.findByText('Answer for q1');
  }

  it('opens on all study questions with the newest one shown in full', async () => {
    await renderLoaded();
    const range = lastRange();
    expect(new Date(range.endAt).getTime() - new Date(range.startAt).getTime()).toBe(30 * DAY);
    expect(lastFilters()).toMatchObject({ needsAttention: false, studyOnly: true, topicText: null });
    expect(api.fetchQuestionDetail).toHaveBeenLastCalledWith('c1', range, 'q1');
    expect(api.fetchCitedFiles).toHaveBeenLastCalledWith('c1', range);
    expect(api.labelQuestions).toHaveBeenCalledWith('c1', range);
    expect(mocks.useAnalyticsChat).toHaveBeenLastCalledWith('c1', range.startAt, range.endAt);

    expect(screen.getByText(/27 questions · 2 students/)).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Question views' })).getByRole('button', { name: 'All questions, 27' })).toBeInTheDocument();
    expect(screen.getByText(/70% answered from materials/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All questions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /What is double hashing\?/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'ask sheet' })).toHaveAttribute('data-same-chat', 'true');
  });

  it('opens another question, including a related one', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: /when is double hashing used/ }));
    expect(await screen.findByText('Answer for q2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /a related question/ }));
    expect(await screen.findByText('Answer for q9')).toBeInTheDocument();
  });

  it('switches views from the left pane and shows the first question of each', async () => {
    await renderLoaded();
    const nav = screen.getByRole('navigation', { name: 'Question views' });

    fireEvent.click(within(nav).getByRole('button', { name: 'Not from materials, 8' }));
    expect(await screen.findByText('Answer for g1')).toBeInTheDocument();
    expect(lastFilters()).toMatchObject({ needsAttention: true });
    expect(screen.getByRole('heading', { name: 'Not answered from materials' })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: 'Hashing.pdf, 20' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ materialIds: ['m1', 'm2'] }));
    fireEvent.click(await within(nav).findByRole('button', { name: 'Comparison, 3' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ category: 'comparison' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide greetings and logistics' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ category: 'comparison', studyOnly: false }));
  });

  it('searches a topic in the materials and the questions', async () => {
    api.matchKeyword.mockResolvedValue([
      { key: 'm1:page:2', materialId: 'm1', fileName: 'Hashing.pdf', fileType: 'pdf', pageNumber: 2, startMs: null, endMs: null, similarity: 0.5, snippet: '', chunkCount: 1 },
    ]);
    await renderLoaded();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all questions' }), { target: { value: 'probing' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(lastFilters()).toMatchObject({ topicText: 'probing', topicPlaces: [{ material_id: 'm1', page_number: 2 }] }));
    expect(screen.getByRole('heading', { name: 'About “probing”' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ topicText: 'probing', topicPlaces: null }));
    expect(screen.getByRole('heading', { name: 'Mentions “probing”' })).toBeInTheDocument();
    expect(api.matchKeyword).toHaveBeenCalledTimes(1);
  });

  it('switches presets and validates a custom range', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: /Last 30 days/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Last 7 days' }));
    await waitFor(() => {
      const range = lastRange();
      expect(new Date(range.endAt).getTime() - new Date(range.startAt).getTime()).toBe(7 * DAY);
    });

    fireEvent.click(screen.getByRole('button', { name: /Last 7 days/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Custom range' }));
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).not.toBe('');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2030-01-02T00:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2030-01-01T00:00' } });
    expect(screen.getAllByText('Start date and time must be earlier than or equal to the end date and time.').length).toBeGreaterThan(0);
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
