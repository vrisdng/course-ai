import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authState: {} as Record<string, unknown>, updateUser: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.authState }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { updateUser: mocks.updateUser } } }));
import ResetPassword from './ResetPassword';

const renderPage = (entry = '/reset-password') => render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/reset-password" element={<ResetPassword />} />
  <Route path="/auth" element={<div>auth destination</div>} />
  <Route path="/chat" element={<div>chat destination</div>} />
  <Route path="/admin-dashboard" element={<div>admin destination</div>} />
</Routes></MemoryRouter>);

const fillPasswords = (password: string, confirm = password) => {
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirm } });
};

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState = { user: { id: 'u1' }, profile: { role: 'student' }, isLoading: false };
    mocks.updateUser.mockResolvedValue({ error: null });
  });

  it('shows a loading state while the recovery session is being established', () => {
    mocks.authState = { user: null, profile: null, isLoading: true };
    const { container } = renderPage();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument();
  });

  it('explains when the link did not produce a session and offers to request a new one', () => {
    mocks.authState = { user: null, profile: null, isLoading: false };
    renderPage();
    expect(screen.getByText(/link is invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/auth?mode=forgot');
  });

  it('surfaces the error Supabase places in the URL hash for expired links', () => {
    mocks.authState = { user: null, profile: null, isLoading: false };
    renderPage('/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(screen.getByText('Email link is invalid or has expired')).toBeInTheDocument();
  });

  it('validates password length and confirmation before calling Supabase', async () => {
    renderPage();
    fillPasswords('short', 'different');
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument();
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('updates the password and sends students to chat', async () => {
    renderPage();
    fillPasswords('newsecret1');
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'newsecret1' }));
    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
    expect(await screen.findByText('chat destination')).toBeInTheDocument();
  });

  it('sends admins to the dashboard after a successful update', async () => {
    mocks.authState = { user: { id: 'u1' }, profile: { role: 'admin' }, isLoading: false };
    renderPage();
    fillPasswords('newsecret1');
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('admin destination')).toBeInTheDocument();
  });

  it('shows the provider error when the update fails', async () => {
    mocks.updateUser.mockResolvedValue({ error: { message: 'New password should be different from the old password.' } });
    renderPage();
    fillPasswords('newsecret1');
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('New password should be different from the old password.')).toBeInTheDocument();
    expect(screen.queryByText('chat destination')).not.toBeInTheDocument();
  });
});
