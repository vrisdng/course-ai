import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authState: {} as Record<string, unknown>, signIn: vi.fn(), signUp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.authState }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { signInWithPassword: mocks.signIn, signUp: mocks.signUp, verifyOtp: mocks.verifyOtp } } }));
import Auth from './Auth';

const renderPage = (entry = '/auth') => render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/auth" element={<Auth />} /><Route path="/chat" element={<div>chat destination</div>} /><Route path="/admin-dashboard" element={<div>admin destination</div>} /><Route path="/" element={<div>invite destination</div>} />
</Routes></MemoryRouter>);

describe('Auth', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.authState = { user: null, profile: null, isLoading: false }; mocks.signIn.mockResolvedValue({ error: null }); mocks.signUp.mockResolvedValue({ error: null }); mocks.verifyOtp.mockResolvedValue({ error: null }); });
  it('validates credentials and maps authentication provider errors', async () => {
    mocks.signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } }); renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Please enter a valid email address')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@example.test' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } }); fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({ email: 'student@example.test', password: 'secret12' }));
    expect(await screen.findByText('Invalid email or password. Please try again.')).toBeInTheDocument();
  });
  it('creates an invited account with profile metadata and confirmation messaging', async () => {
    renderPage('/auth?mode=signup&invite=JOIN1&email=INVITED%40EXAMPLE.TEST');
    expect(screen.getByText(/joining via course invite/)).toBeInTheDocument(); expect(screen.getByLabelText('Email')).toHaveValue('invited@example.test');
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Ada Student' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } }); fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'secret12' } }); fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'invited@example.test', password: 'secret12', options: expect.objectContaining({ data: { full_name: 'Ada Student' } }) })));
    expect(await screen.findByText(/Account created! Please check your email/)).toBeInTheDocument();
  });
  it('redirects authenticated users according to role and preserves invite enrollment', async () => {
    mocks.authState = { user: { id: 'u1' }, profile: { role: 'admin', email: 'admin@example.test' }, isLoading: false }; const { unmount } = renderPage();
    expect(await screen.findByText('admin destination')).toBeInTheDocument(); unmount();
    renderPage('/auth?invite=JOIN1'); expect(await screen.findByText('invite destination')).toBeInTheDocument();
  });
  it('shows an authentication loading state', () => { mocks.authState = { user: null, profile: null, isLoading: true }; const { container } = renderPage(); expect(container.querySelector('.animate-spin')).toBeInTheDocument(); });
  it.each([
    ['Email not confirmed', 'Please verify your email address before signing in.'],
    ['Provider unavailable', 'Provider unavailable'],
  ])('maps the sign-in error %s', async (providerMessage, visibleMessage) => {
    mocks.signIn.mockResolvedValue({ error: { message: providerMessage } }); renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@example.test' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } }); fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText(new RegExp(visibleMessage))).toBeInTheDocument();
  });
  it('validates sign-up fields and maps duplicate-account errors', async () => {
    mocks.signUp.mockResolvedValue({ error: { message: 'User already registered' } }); renderPage('/auth?mode=signup');
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'A' } }); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.test' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } }); fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'different' } }); fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument(); expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Ada' } }); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.test' } }); fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'secret12' } }); fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(await screen.findByText('An account with this email already exists. Please sign in instead.')).toBeInTheDocument();
  });
});
