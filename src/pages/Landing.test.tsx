import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, invoke: vi.fn(), getSession: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke }, auth: { getSession: mocks.getSession } } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
import Landing from './Landing';

const renderPage = (entry = '/') => render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/" element={<Landing />} /><Route path="/chat" element={<div>chat destination</div>} />
  <Route path="/auth" element={<div>auth destination</div>} />
</Routes></MemoryRouter>);

describe('Landing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { isAdmin: false, user: null, profile: null, isLoading: false, refreshProfile: vi.fn() };
    mocks.getSession.mockResolvedValue({ data: { session: null } });
  });
  it('renders the complete product overview and role-aware primary actions', () => {
    const { unmount } = renderPage();
    expect(screen.getByRole('heading', { name: /Learn from your materials/ })).toBeInTheDocument();
    expect(screen.getByText('Upload course files')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open chat' }).length).toBeGreaterThan(0); unmount();
    mocks.auth.isAdmin = true; renderPage();
    expect(screen.getAllByRole('link', { name: 'Open dashboard' }).length).toBeGreaterThan(0);
  });
  it.each([false, true])('explains retired links without checking or redeeming them (signed in: %s)', (signedIn) => {
    mocks.auth.user = signedIn ? { email: 'student@example.test' } : null;
    renderPage('/?invite=OLD&email=student%40example.test');
    expect(screen.getByText('Course invitation links have been retired.')).toBeInTheDocument();
    expect(screen.getByText(/Contact your lecturer to be added to your course/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enroll|check my account/i })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
