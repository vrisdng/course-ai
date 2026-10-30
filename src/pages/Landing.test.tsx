import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, invoke: vi.fn(), getSession: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke }, auth: { getSession: mocks.getSession } } }));
import { PasswordChangeGate } from '@/components/auth/PasswordChangeGate';
import Landing from './Landing';

function SetupDestination() {
  const location = useLocation();
  return <div>setup destination:{location.state?.from}</div>;
}

function Page({ gated = false }: { gated?: boolean }) {
  const routes = <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/chat" element={<div>chat destination</div>} />
    <Route path="/admin-dashboard" element={<div>admin destination</div>} />
    <Route path="/auth" element={<div>auth destination</div>} />
    <Route path="/reset-password" element={<SetupDestination />} />
  </Routes>;
  return gated ? <PasswordChangeGate>{routes}</PasswordChangeGate> : routes;
}

const renderPage = (entry = '/', gated = false) => render(<MemoryRouter initialEntries={[entry]}><Page gated={gated} /></MemoryRouter>);

describe('Landing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { user: null, profile: null, isLoading: false, isAdmin: false };
  });

  it('renders a public overview of the actual course tools', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /Learn better with course AI/i })).toBeInTheDocument();
    for (const name of ['Answers with sources', 'Notes and webcasts', 'Flashcards for revision', 'Built for your course']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Illustrative course conversation')).toBeInTheDocument();
    expect(screen.getByText(/Use your email and password/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /guest|NUS account/i })).not.toBeInTheDocument();
  });

  it('sends every sign-in CTA to the existing email and password flow', () => {
    renderPage('/?invite=OLD&email=student%40example.test');
    const links = screen.getAllByRole('link', { name: /sign in/i });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/auth?mode=signin');
    fireEvent.click(links[0]);
    expect(screen.getByText('auth destination')).toBeInTheDocument();
  });

  it('links navigation to real sections without nested interactive controls', () => {
    const { container } = renderPage();
    for (const link of container.querySelectorAll('a[href^="#"]')) {
      expect(container.querySelector(link.getAttribute('href')!)).not.toBeNull();
    }
    expect(container.querySelector('a button, button a')).toBeNull();
  });

  it.each([true, false])('waits for authentication and role readiness (auth loading: %s)', (isLoading) => {
    mocks.auth = { ...mocks.auth, user: { id: 'student' }, isLoading };
    const { rerender } = renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your account');
    expect(screen.queryByText('chat destination')).not.toBeInTheDocument();
    mocks.auth = { ...mocks.auth, isLoading: false, profile: { role: 'admin' }, isAdmin: true };
    rerender(<MemoryRouter><Page /></MemoryRouter>);
    expect(screen.getByText('admin destination')).toBeInTheDocument();
  });

  it.each(['student', 'admin'])('redirects signed-in %s users to their app, including retired links', (role) => {
    mocks.auth = { ...mocks.auth, user: { id: role }, profile: { role }, isAdmin: role === 'admin' };
    renderPage('/?invite=OLD');
    expect(screen.getByText(`${role === 'admin' ? 'admin' : 'chat'} destination`)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it.each(['/?invite=OLD&email=student%40example.test', '/?invite='])('explains retired public links without checking or redeeming them: %s', (entry) => {
    renderPage(entry);
    expect(screen.getByText('Course invitation links have been retired.')).toBeInTheDocument();
    expect(screen.getByText(/Contact your lecturer to be added to your course/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enroll|check my account/i })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('preserves the required-password gate before any app redirect', () => {
    mocks.auth = { ...mocks.auth, user: { app_metadata: { must_change_password: true } } };
    renderPage('/?invite=OLD', true);
    expect(screen.getByText('setup destination:/')).toBeInTheDocument();
    expect(screen.queryByText('chat destination')).not.toBeInTheDocument();
  });
});
