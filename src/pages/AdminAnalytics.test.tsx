import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), chat: {} as Record<string, unknown>, toastError: vi.fn() }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/analytics-chat/useAnalyticsChat', () => ({ useAnalyticsChat: () => mocks.chat }));
vi.mock('@/features/analytics-chat/AnalyticsChatMessageList', () => ({ AnalyticsChatMessageList: ({ onSuggestionClick }: { onSuggestionClick: (s: string) => void }) => <button onClick={() => onSuggestionClick('Summarize activity')}>suggestion</button> }));
vi.mock('@/features/student-chat/ChatComposer', () => ({ ChatComposer: ({ onSend, onStop, disabled }: { onSend: () => void; onStop: () => void; disabled: boolean }) => <div><button onClick={onSend} disabled={disabled}>send analytics</button><button onClick={onStop}>stop analytics</button></div> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
import AdminAnalytics from './AdminAnalytics';

function chain(result: unknown) { const q: Record<string, unknown> = {}; for (const m of ['select', 'order', 'eq', 'gte', 'lte']) q[m] = vi.fn(() => q); q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve); return q; }

describe('AdminAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat = { messages: [], input: '', setInput: vi.fn(), isLoading: false, handleSend: vi.fn(), stopGenerating: vi.fn(), clearChat: vi.fn() };
    mocks.from.mockImplementation((table: string) => table === 'courses'
      ? chain({ data: [{ id: 'c1', name: 'Algorithms', code: 'CS101' }], error: null })
      : chain({ count: table === 'enrollments' ? 20 : table === 'materials' ? 8 : 42, data: null, error: null }));
    mocks.rpc.mockResolvedValue({ data: 12, error: null });
  });
  it('loads the first course, aggregates stats and delegates chat controls', async () => {
    render(<AdminAnalytics />);
    expect(await screen.findByText('Course Analytics')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('20').length).toBeGreaterThan(0));
    expect(screen.getAllByText('12').length).toBeGreaterThan(0); expect(screen.getAllByText('8').length).toBeGreaterThan(0); expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'suggestion' })); fireEvent.click(screen.getByRole('button', { name: 'send analytics' })); fireEvent.click(screen.getByRole('button', { name: 'stop analytics' }));
    expect(mocks.chat.setInput).toHaveBeenCalledWith('Summarize activity'); expect(mocks.chat.handleSend).toHaveBeenCalled(); expect(mocks.chat.stopGenerating).toHaveBeenCalled();
  });
  it('blocks analytics for invalid date ranges and resets to the last 30 days', async () => {
    render(<AdminAnalytics />); await screen.findByText('Course Analytics');
    const start = screen.getByLabelText('Start'); const end = screen.getByLabelText('End');
    fireEvent.change(start, { target: { value: '2030-01-02T00:00' } }); fireEvent.change(end, { target: { value: '2030-01-01T00:00' } });
    expect(screen.getByText('Start date and time must be earlier than or equal to the end date and time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'send analytics' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' })); expect(screen.queryByText(/Start date and time must/)).not.toBeInTheDocument();
  });
  it('explains each missing or malformed date boundary', async () => {
    render(<AdminAnalytics />); await screen.findByText('Course Analytics');
    const start = screen.getByLabelText('Start'); const end = screen.getByLabelText('End');
    fireEvent.change(start, { target: { value: '' } }); expect(screen.getByText('Choose a start date and time.')).toBeInTheDocument();
    fireEvent.change(start, { target: { value: '2026-01-01T00:00' } }); fireEvent.change(end, { target: { value: '' } }); expect(screen.getByText('Choose an end date and time.')).toBeInTheDocument();
  });
  it('handles course loading failures and the no-course state', async () => {
    mocks.from.mockImplementation((table: string) => table === 'courses' ? chain({ data: null, error: { message: 'offline' } }) : chain({ count: 0 }));
    render(<AdminAnalytics />);
    expect(await screen.findByText('Course Analytics')).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith('offline'); expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
