import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ user: null as null | { app_metadata: { must_change_password: boolean } } }));
vi.mock('./contexts/AuthContext', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useAuth: () => ({ user: auth.user, isLoading: false }) }));
vi.mock('./components/auth/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./pages/Landing', () => ({ default: () => <div>landing</div> }));
vi.mock('./pages/Auth', () => ({ default: () => <div>auth</div> }));
vi.mock('./pages/ResetPassword', () => ({ default: () => <div>reset password</div> }));
vi.mock('./pages/StudentChat', () => ({ default: () => <div>chat</div> }));
vi.mock('./pages/AdminDashboard', () => ({ default: () => <div>dashboard</div> }));
vi.mock('./pages/CourseStudents', () => ({ default: () => <div>students</div> }));
vi.mock('./pages/AdminAnalytics', () => ({ default: () => <div>analytics</div> }));
vi.mock('./pages/Settings', () => ({ default: () => <div>settings</div> }));
vi.mock('./pages/NotFound', () => ({ default: () => <div>not found</div> }));

describe('App routing', () => {
  beforeEach(() => { auth.user = null; window.history.pushState({}, '', '/'); vi.resetModules(); });
  it('blocks normal routes for imported accounts until the password changes', async () => {
    auth.user = { app_metadata: { must_change_password: true } };
    window.history.pushState({}, '', '/chat');
    const { default: App } = await import('./App'); render(<App />);
    expect(await screen.findByText('reset password')).toBeInTheDocument();
    expect(screen.queryByText('chat')).not.toBeInTheDocument();
  });
  it.each([
    ['/', 'landing'], ['/auth', 'auth'], ['/reset-password', 'reset password'], ['/chat/conversation-1', 'chat'], ['/admin-dashboard', 'dashboard'],
    ['/admin-dashboard/courses/c1/students', 'students'], ['/admin-analytics', 'analytics'], ['/settings', 'settings'], ['/missing', 'not found'],
  ])('routes %s to %s', async (path, expected) => {
    window.history.pushState({}, '', path); const { default: App } = await import('./App'); render(<App />); expect(screen.getByText(expected)).toBeInTheDocument();
  });
  it('redirects the legacy admin route', async () => { window.history.pushState({}, '', '/admin'); const { default: App } = await import('./App'); render(<App />); expect(await screen.findByText('dashboard')).toBeInTheDocument(); });
});
