import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authState: {} as Record<string, unknown>, updateUser: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.authState }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { updateUser: mocks.updateUser, verifyOtp: mocks.verifyOtp } } }));
import ResetPassword from './ResetPassword';

type Entry = string | { pathname: string; hash?: string; state?: unknown };
const renderPage = (entry: Entry = '/reset-password') => render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/reset-password" element={<ResetPassword />} />
  <Route path="/auth" element={<div>auth destination</div>} />
  <Route path="/chat" element={<div>chat destination</div>} />
  <Route path="/admin-dashboard" element={<div>admin destination</div>} />
</Routes></MemoryRouter>);

const withEmail = (email: string): Entry => ({ pathname: '/reset-password', state: { email } });

const fillPasswords = (password: string, confirm = password) => {
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirm } });
};

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState = { user: { id: 'u1' }, profile: { role: 'student' }, isLoading: false };
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it('shows a loading state while the session is being established', () => {
    mocks.authState = { user: null, profile: null, isLoading: true };
    const { container } = renderPage();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument();
  });

  describe('code entry (no session yet)', () => {
    beforeEach(() => { mocks.authState = { user: null, profile: null, isLoading: false }; });

    it('prefills the email handed over from the forgot-password form and verifies the code', async () => {
      renderPage(withEmail('student@example.test'));
      expect(screen.getByLabelText('Email')).toHaveValue('student@example.test');
      fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
      await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: 'student@example.test', token: '123456', type: 'recovery' }));
    });

    it('asks for the email when it was not handed over', async () => {
      renderPage();
      expect(screen.getByLabelText('Email')).toHaveValue('');
      fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
      expect(await screen.findByText('Please enter a valid email address')).toBeInTheDocument();
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    });

    it('requires a 6-digit numeric code', async () => {
      renderPage(withEmail('student@example.test'));
      fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '12ab' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
      expect(await screen.findByText('Enter the 6-digit code from the email')).toBeInTheDocument();
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    });

    it('shows the provider error for a wrong or expired code', async () => {
      mocks.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
      renderPage(withEmail('student@example.test'));
      fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '000000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
      expect(await screen.findByText('Token has expired or is invalid')).toBeInTheDocument();
    });

    it('offers a way to request a new code', () => {
      renderPage(withEmail('student@example.test'));
      expect(screen.getByRole('link', { name: /request a new code/i })).toHaveAttribute('href', '/auth?mode=forgot');
    });

    it('still surfaces errors Supabase places in the URL hash for legacy links', () => {
      renderPage({ pathname: '/reset-password', hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
      expect(screen.getByText('Email link is invalid or has expired')).toBeInTheDocument();
      expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
    });
  });

  describe('new password (session present)', () => {
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
});
