import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => state.auth }));
import { PasswordChangeGate } from './PasswordChangeGate';

function Setup() {
  const location = useLocation();
  return <div>setup:{location.state?.from}</div>;
}
function page(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><PasswordChangeGate><Routes>
    <Route path="/reset-password" element={<Setup />} />
    <Route path="*" element={<div>normal access</div>} />
  </Routes></PasswordChangeGate></MemoryRouter>);
}
describe('PasswordChangeGate', () => {
  beforeEach(() => { state.auth = { user: null, isLoading: false }; });
  it('blocks normal pages without forwarding retired invite parameters', () => {
    state.auth.user = { app_metadata: { must_change_password: true } };
    page('/?invite=abc&email=student%40example.test');
    expect(screen.getByText('setup:/')).toBeInTheDocument();
    expect(screen.queryByText('normal access')).not.toBeInTheDocument();
  });
  it('preserves unrelated navigation parameters and anchors during setup', () => {
    state.auth.user = { app_metadata: { must_change_password: true } };
    page('/settings?tab=profile#password');
    expect(screen.getByText('setup:/settings?tab=profile#password')).toBeInTheDocument();
  });
  it('allows setup itself and users who do not need setup', () => {
    state.auth.user = { app_metadata: { must_change_password: true } };
    const first = page('/reset-password');
    expect(screen.getByText('setup:')).toBeInTheDocument(); first.unmount();
    state.auth.user = { app_metadata: {} };
    page('/chat'); expect(screen.getByText('normal access')).toBeInTheDocument();
  });
  it('requires password setup when signing in from a retired invite', () => {
    state.auth.user = { app_metadata: { must_change_password: true } };
    page('/auth?invite=abc&email=student%40example.test');
    expect(screen.getByText('setup:/auth')).toBeInTheDocument();
  });
  it('does not mount normal pages before authentication has loaded', () => {
    state.auth.isLoading = true;
    page('/chat'); expect(screen.queryByText('normal access')).not.toBeInTheDocument();
  });
  it('resumes name setup after the imported student has changed their password', () => {
    state.auth.user = { app_metadata: { must_change_password: false } };
    state.auth.profile = { role: 'student', full_name: '  ' };
    page('/chat');
    expect(screen.getByText('setup:/chat')).toBeInTheDocument();
    expect(screen.queryByText('normal access')).not.toBeInTheDocument();
  });
  it('requires password setup even when the imported student already has a name', () => {
    state.auth.user = { app_metadata: { must_change_password: true } };
    state.auth.profile = { role: 'student', full_name: 'Ada Lovelace' };
    page('/chat');
    expect(screen.getByText('setup:/chat')).toBeInTheDocument();
    expect(screen.queryByText('normal access')).not.toBeInTheDocument();
  });
  it('allows imported students with names and ordinary existing accounts', () => {
    state.auth.user = { app_metadata: { must_change_password: false } };
    state.auth.profile = { role: 'student', full_name: 'Ngọc Mai' };
    const first = page('/chat');
    expect(screen.getByText('normal access')).toBeInTheDocument(); first.unmount();
    state.auth.user = { app_metadata: {} };
    state.auth.profile = { role: 'student', full_name: '' };
    page('/chat'); expect(screen.getByText('normal access')).toBeInTheDocument();
  });
});
