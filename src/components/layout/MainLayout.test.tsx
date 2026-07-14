import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }));
import { MainLayout } from './MainLayout';

const renderLayout = (showFooter?: boolean) => render(<MemoryRouter><MainLayout showFooter={showFooter}><div>page content</div></MainLayout></MemoryRouter>);
describe('MainLayout', () => {
  it('shows public navigation and an optional current-year footer', () => {
    auth.value = { user: null, profile: null, isAdmin: false, signOut: vi.fn() };
    const { unmount } = renderLayout();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth');
    expect(screen.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/auth?mode=signup');
    expect(screen.getByText(new RegExp(String(new Date().getFullYear())))).toBeInTheDocument(); unmount();
    renderLayout(false); expect(screen.queryByText(/All rights reserved/)).not.toBeInTheDocument();
  });
  it('shows role-aware authenticated navigation and profile initials', () => {
    auth.value = { user: { email: 'admin@example.test' }, profile: { full_name: 'Ada Lovelace', role: 'admin', avatar_url: null }, isAdmin: true, signOut: vi.fn() };
    renderLayout();
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin-dashboard');
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/admin-analytics');
    expect(screen.getByText('AL')).toBeInTheDocument(); expect(screen.getByText('page content')).toBeInTheDocument();
  });
  it('falls back to email initials when the profile has no name', () => {
    auth.value = { user: { email: 'student@example.test' }, profile: { full_name: null, role: 'student', avatar_url: null }, isAdmin: false, signOut: vi.fn() };
    renderLayout(); expect(screen.getByText('ST')).toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });
});
