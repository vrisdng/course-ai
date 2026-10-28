import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readProfile = vi.fn();
  const saveProfile = vi.fn();
  const saveEq = vi.fn(() => ({ select: vi.fn(() => ({ single: saveProfile })) }));
  const updateProfile = vi.fn(() => ({ eq: saveEq }));
  const from = vi.fn(() => ({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readProfile })) })), update: updateProfile,
  }));
  return { authState: {} as Record<string, unknown>, updateUser: vi.fn(), verifyOtp: vi.fn(), refreshSession: vi.fn(),
    refreshProfile: vi.fn(), readProfile, saveProfile, saveEq, updateProfile, from };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.authState }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { updateUser: mocks.updateUser, verifyOtp: mocks.verifyOtp, refreshSession: mocks.refreshSession }, from: mocks.from } }));
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
    mocks.readProfile.mockResolvedValue({ data: { full_name: 'Existing Student' }, error: null });
    mocks.saveProfile.mockResolvedValue({ data: { user_id: 'u1' }, error: null });
    mocks.refreshProfile.mockResolvedValue(undefined);
    mocks.refreshSession.mockResolvedValue({ data: { session: { user: { app_metadata: { must_change_password: false } } } }, error: null });
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

    it('accepts any project OTP length from 6 to 10 digits', async () => {
      renderPage(withEmail('student@example.test'));
      fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '33526675' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
      await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ token: '33526675' })));
    });

    it('rejects non-numeric or too-short codes', async () => {
      renderPage(withEmail('student@example.test'));
      fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '12ab' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
      expect(await screen.findByText('Enter the numeric code from the email')).toBeInTheDocument();
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
    it('asks an imported student for their name after password setup, before entering the app', async () => {
      mocks.authState = { user: { id: 'u1', app_metadata: { must_change_password: true } }, isLoading: false, refreshProfile: mocks.refreshProfile };
      mocks.readProfile.mockResolvedValue({ data: { full_name: '' }, error: null });
      renderPage(); fillPasswords('MyOwnPassword9!');
      fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
      expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
      expect(screen.queryByText('chat destination')).not.toBeInTheDocument();
      expect(mocks.readProfile.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.refreshSession.mock.invocationCallOrder[0]);
      fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  Ngọc Mai  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByText('chat destination')).toBeInTheDocument();
      expect(mocks.updateProfile).toHaveBeenCalledWith({ full_name: 'Ngọc Mai' });
      expect(mocks.saveEq).toHaveBeenCalledWith('user_id', 'u1');
      expect(mocks.refreshProfile).toHaveBeenCalledOnce();
      expect(mocks.updateUser).toHaveBeenCalledOnce();
    });
    it('finishes a named import after password replacement without asking for a name again', async () => {
      mocks.authState = { user: { id: 'u1', app_metadata: { must_change_password: true } },
        profile: { role: 'student', full_name: 'Ada Lovelace' }, isLoading: false };
      mocks.readProfile.mockResolvedValue({ data: { full_name: 'Ada Lovelace' }, error: null });
      renderPage();
      expect(screen.getByLabelText('New Password')).toBeInTheDocument();
      fillPasswords('MyOwnPassword9!');
      fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
      expect(await screen.findByText('chat destination')).toBeInTheDocument();
      expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'MyOwnPassword9!' });
      expect(mocks.refreshSession).toHaveBeenCalledOnce();
      expect(mocks.readProfile).toHaveBeenCalledOnce();
      expect(mocks.updateProfile).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    });
    it('resumes unfinished name setup without changing the password again', async () => {
      mocks.authState = { user: { id: 'u1', app_metadata: { must_change_password: false } },
        profile: { role: 'student', full_name: '' }, isLoading: false, refreshProfile: mocks.refreshProfile };
      mocks.refreshProfile.mockImplementationOnce(async () => { mocks.authState.profile = { role: 'student', full_name: 'Ada Lovelace' }; });
      renderPage();
      fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Lovelace' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByText('Name saved. Redirecting you now...')).toBeInTheDocument();
      expect(screen.getByLabelText('Full name')).toBeInTheDocument();
      expect(await screen.findByText('chat destination')).toBeInTheDocument();
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect(mocks.refreshSession).not.toHaveBeenCalled();
    });
    it('validates names and keeps the name form available when saving fails', async () => {
      mocks.authState = { user: { id: 'u1', app_metadata: { must_change_password: false } },
        profile: { role: 'student', full_name: null }, isLoading: false, refreshProfile: mocks.refreshProfile };
      mocks.saveProfile.mockResolvedValueOnce({ data: null, error: { message: 'Could not save your name' } });
      renderPage();
      fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByText('Enter your name')).toBeInTheDocument();
      expect(mocks.updateProfile).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'A'.repeat(201) } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByText('Name must be 200 characters or fewer')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '李' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByText('Could not save your name')).toBeInTheDocument();
      expect(screen.queryByText('chat destination')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByText('chat destination')).toBeInTheDocument();
      expect(mocks.updateUser).not.toHaveBeenCalled();
    });
    it('retries a failed profile read without submitting the new password twice', async () => {
      mocks.authState = { user: { id: 'u1', app_metadata: { must_change_password: true } }, isLoading: false };
      mocks.readProfile.mockResolvedValueOnce({ data: null, error: { message: 'Offline' } });
      renderPage(); fillPasswords('MyOwnPassword9!');
      fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
      expect(await screen.findByText(/Password updated, but your profile could not be loaded/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Finish account setup' }));
      expect(await screen.findByText('chat destination')).toBeInTheDocument();
      expect(mocks.updateUser).toHaveBeenCalledOnce();
    });
    it('requires imported users to replace the initial password without sending a recovery email', async () => {
      mocks.authState = { user: { id: 'u1', app_metadata: { must_change_password: true } }, isLoading: false };
      mocks.refreshSession.mockResolvedValue({ data: { session: { user: { app_metadata: { must_change_password: false } } } }, error: null });
      renderPage();
      fillPasswords('iLoveStudying8!');
      fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
      expect(await screen.findByText('Choose a password different from the initial password.')).toBeInTheDocument();
      expect(mocks.updateUser).not.toHaveBeenCalled();
      fillPasswords('MyOwnPassword9!');
      fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
      expect(await screen.findByText('chat destination')).toBeInTheDocument();
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'MyOwnPassword9!' });
      expect(mocks.refreshSession).toHaveBeenCalledOnce();
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
      expect(mocks.updateProfile).not.toHaveBeenCalled();
    });
    it('does not unlock if the server still reports a pending password change', async () => {
      mocks.authState = { user: { id: 'u1', app_metadata: { must_change_password: true } }, isLoading: false };
      mocks.refreshSession.mockResolvedValue({ data: { session: { user: { app_metadata: { must_change_password: true } } } }, error: null });
      renderPage(); fillPasswords('MyOwnPassword9!');
      fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
      expect(await screen.findByText(/Account setup is still pending/)).toBeInTheDocument();
      expect(screen.queryByText('chat destination')).not.toBeInTheDocument();
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
});
