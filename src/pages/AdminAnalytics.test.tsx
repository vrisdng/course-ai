import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), chat: {} as Record<string, unknown>, toastError: vi.fn(),
  useAnalyticsChat: vi.fn((_course: string | null, _start: string | null, _end: string | null) => ({})),
  useCitedMaterials: vi.fn((_courseId: string | null, _range: unknown) => ({ marker: 'materials', materials: [{}, {}, {}] })),
  useKeywordSearch: vi.fn((_courseId: string | null, _range: unknown) => ({ marker: 'keyword' })),
  useQuestionLabels: vi.fn((_courseId: string | null, _range: unknown) => ({ marker: 'labels', buckets: [] })),
}));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/analytics-chat/useAnalyticsChat', () => ({
  useAnalyticsChat: (course: string | null, start: string | null, end: string | null) => {
    mocks.useAnalyticsChat(course, start, end);
    return mocks.chat;
  },
}));
vi.mock('@/features/course-analytics/useCitedMaterials', () => ({ useCitedMaterials: mocks.useCitedMaterials }));
vi.mock('@/features/course-analytics/useKeywordSearch', () => ({ useKeywordSearch: mocks.useKeywordSearch }));
vi.mock('@/features/course-analytics/useQuestionLabels', () => ({ useQuestionLabels: mocks.useQuestionLabels }));
vi.mock('@/features/course-analytics/MaterialsExplorer', () => ({
  MaterialsExplorer: ({ materials, keyword }: { materials: { marker: string }; keyword: { marker: string } }) => <p>explorer:{materials.marker}+{keyword.marker}</p>,
}));
vi.mock('@/features/course-analytics/QuestionBucketsPanel', () => ({ QuestionBucketsPanel: ({ state }: { state: { marker: string } }) => <p>panel:{state.marker}</p> }));
vi.mock('@/features/course-analytics/AskAnalyticsSheet', () => ({
  AskAnalyticsSheet: ({ chat, disabledReason }: { chat: unknown; disabledReason: string | null }) =>
    <button disabled={Boolean(disabledReason)} data-same-chat={String(chat === mocks.chat)}>ask sheet</button>,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
import AdminAnalytics from './AdminAnalytics';

function chain(result: unknown) { const q: Record<string, unknown> = {}; for (const m of ['select', 'order', 'eq', 'is', 'gte', 'lte']) q[m] = vi.fn(() => q); q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve); return q; }

const DAY = 24 * 3600 * 1000;
const lastRange = () => mocks.useCitedMaterials.mock.lastCall?.[1] as { startAt: string; endAt: string } | null;

describe('AdminAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat = { messages: [], input: '', setInput: vi.fn(), isLoading: false, handleSend: vi.fn(), stopGenerating: vi.fn(), clearChat: vi.fn() };
    mocks.from.mockImplementation((table: string) => table === 'courses'
      ? chain({ data: [{ id: 'c1', name: 'Algorithms', code: 'CS101' }, { id: 'c2', name: 'Databases', code: null }], error: null })
      : chain({ count: table === 'enrollments' ? 20 : table === 'materials' ? 8 : 42, data: null, error: null }));
    mocks.rpc.mockResolvedValue({ data: 12, error: null });
  });

  it('loads the first course, its stats and every analytics view for the last 30 days', async () => {
    render(<AdminAnalytics />);
    expect(await screen.findByRole('heading', { name: 'Course analytics' })).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Questions' })).getByText('42')).toBeInTheDocument());

    const queryIndex = mocks.from.mock.calls.findIndex(([table]) => table === 'query_events');
    const questionsQuery = mocks.from.mock.results[queryIndex].value;
    expect(questionsQuery.eq).toHaveBeenCalledWith('outcome', 'success');
    expect(questionsQuery.is).toHaveBeenCalledWith('error_code', null);
    expect(within(screen.getByRole('group', { name: 'Active students' })).getByText('of 20 enrolled')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Materials cited' })).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Materials cited' })).getByText('of 8 materials')).toBeInTheDocument();

    const range = lastRange()!;
    expect(new Date(range.endAt).getTime() - new Date(range.startAt).getTime()).toBe(30 * DAY);
    expect(mocks.useCitedMaterials).toHaveBeenLastCalledWith('c1', range);
    expect(mocks.useKeywordSearch).toHaveBeenLastCalledWith('c1', range);
    expect(mocks.useQuestionLabels).toHaveBeenLastCalledWith('c1', range);
    expect(mocks.useAnalyticsChat).toHaveBeenLastCalledWith('c1', range.startAt, range.endAt);
    expect(screen.getByText('explorer:materials+keyword')).toBeInTheDocument();
    expect(screen.getByText('panel:labels')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ask sheet' })).toHaveAttribute('data-same-chat', 'true');
  });

  it('switches presets and validates a custom range', async () => {
    render(<AdminAnalytics />);
    await screen.findByRole('heading', { name: 'Course analytics' });

    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    let range = lastRange()!;
    expect(new Date(range.endAt).getTime() - new Date(range.startAt).getTime()).toBe(7 * DAY);

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2030-01-02T00:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2030-01-01T00:00' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Start date and time must be earlier than or equal to the end date and time.');
    expect(mocks.useCitedMaterials).toHaveBeenLastCalledWith('c1', null);
    expect(screen.getByRole('button', { name: 'ask sheet' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2030-01-03T00:00' } });
    range = lastRange()!;
    expect(range.startAt).toBe(new Date('2030-01-02T00:00').toISOString());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens custom with the current preset window filled in', async () => {
    render(<AdminAnalytics />);
    await screen.findByRole('heading', { name: 'Course analytics' });
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).not.toBe('');
    expect((screen.getByLabelText('End') as HTMLInputElement).value).not.toBe('');
  });

  it('handles course loading failures and the no-course state', async () => {
    mocks.from.mockImplementation((table: string) => table === 'courses' ? chain({ data: null, error: { message: 'offline' } }) : chain({ count: 0 }));
    render(<AdminAnalytics />);
    expect(await screen.findByRole('heading', { name: 'Course analytics' })).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith('offline');
    expect(screen.getByText(/No courses yet/)).toBeInTheDocument();
  });
});
