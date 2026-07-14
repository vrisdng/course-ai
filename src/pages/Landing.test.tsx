import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('validates an anonymous invite and directs an existing account to sign in', async () => {
    mocks.invoke.mockResolvedValue({ data: {
      valid: true, reason: 'ok', invitedEmail: 'student@example.test', emailMatchesInvite: true,
      accountExists: true, alreadyEnrolled: false, course: { id: 'c1', name: 'Algorithms', code: 'CS101' },
    }, error: null });
    renderPage('/?invite=ABC123&email=STUDENT%40EXAMPLE.TEST');
    expect(await screen.findByText('Invite code is valid for student@example.test.')).toBeInTheDocument();
    expect(screen.getByText(/Use this invite to enroll in Algorithms \(CS101\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign In to Enroll' })).toHaveAttribute('href', expect.stringContaining('invite=ABC123'));
    expect(mocks.invoke).toHaveBeenCalledWith('check-course-invite', { body: { inviteCode: 'ABC123', email: 'student@example.test' } });
  });
  it('rechecks entered email and shows invite mismatch feedback', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { valid: true, reason: 'ok', invitedEmail: 'owner@example.test' }, error: null })
      .mockResolvedValueOnce({ data: { valid: true, reason: 'ok', invitedEmail: 'owner@example.test', emailMatchesInvite: false }, error: null });
    renderPage('/?invite=ABC123');
    await screen.findByText('Invite code is valid for owner@example.test.');
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: ' other@example.test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check My Account' }));
    expect(await screen.findByText('This invite is for a different email address.')).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenLastCalledWith('check-course-invite', { body: { inviteCode: 'ABC123', email: 'other@example.test' } });
  });
  it('redeems a valid signed-in invite, refreshes access, and enters chat', async () => {
    const invite = { valid: true, reason: 'ok', invitedEmail: 'student@example.test', emailMatchesInvite: true, alreadyEnrolled: false };
    mocks.auth = { isAdmin: false, user: { email: 'student@example.test' }, profile: { email: 'student@example.test' }, isLoading: false, refreshProfile: vi.fn() };
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } });
    mocks.invoke.mockImplementation((name: string) => Promise.resolve(name === 'check-course-invite'
      ? { data: invite, error: null } : { data: { success: true, status: 'enrolled' }, error: null }));
    renderPage('/?invite=ABC123');
    fireEvent.click(await screen.findByRole('button', { name: 'Enroll Now' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('redeem-course-invite', { body: { inviteCode: 'ABC123' } }));
    await screen.findByText('chat destination');
    expect(mocks.auth.refreshProfile).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('You have been enrolled.');
  });
  it('shows expired and provider validation errors', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { valid: false, reason: 'expired' }, error: null });
    const { unmount } = renderPage('/?invite=OLD');
    expect(await screen.findByText('This invite has expired.')).toBeInTheDocument(); unmount();
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: 'Service unavailable' } });
    renderPage('/?invite=BAD'); expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
  });
});
