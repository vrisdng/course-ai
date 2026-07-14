import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => state.auth }));
import { ProtectedRoute } from './ProtectedRoute';

function Destination() { const location = useLocation(); return <div>auth:{location.state?.from?.pathname}</div>; }
function renderRoute(requiredRole?: 'student' | 'admin' | Array<'student' | 'admin'>) {
  return render(<MemoryRouter initialEntries={['/private']}><Routes>
    <Route path="/private" element={<ProtectedRoute requiredRole={requiredRole}><div>secret content</div></ProtectedRoute>} />
    <Route path="/auth" element={<Destination />} />
    <Route path="/chat" element={<div>student dashboard</div>} />
    <Route path="/admin-dashboard" element={<div>admin dashboard</div>} />
  </Routes></MemoryRouter>);
}

describe('ProtectedRoute', () => {
  beforeEach(() => { state.auth = { user: null, profile: null, isLoading: false }; });
  it('shows a loading indicator without rendering protected content', () => {
    state.auth = { ...state.auth, isLoading: true };
    const { container } = renderRoute();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });
  it('redirects anonymous users and preserves their original location', () => {
    renderRoute();
    expect(screen.getByText('auth:/private')).toBeInTheDocument();
  });
  it('renders authenticated users when no role or an allowed role is required', () => {
    state.auth = { user: { id: 'u1' }, profile: { role: 'student' }, isLoading: false };
    const { unmount } = renderRoute(); expect(screen.getByText('secret content')).toBeInTheDocument(); unmount();
    renderRoute(['student', 'admin']); expect(screen.getByText('secret content')).toBeInTheDocument();
  });
  it('redirects mismatched roles to their respective dashboards', () => {
    state.auth = { user: { id: 'u1' }, profile: { role: 'admin' }, isLoading: false };
    const { unmount } = renderRoute('student'); expect(screen.getByText('admin dashboard')).toBeInTheDocument(); unmount();
    state.auth = { user: { id: 'u2' }, profile: { role: 'student' }, isLoading: false };
    renderRoute('admin'); expect(screen.getByText('student dashboard')).toBeInTheDocument();
  });
});
