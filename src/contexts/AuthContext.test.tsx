import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { authListener: undefined as ((event: string, session: unknown) => void) | undefined };
  const getSession = vi.fn();
  const signOut = vi.fn();
  const unsubscribe = vi.fn();
  const onAuthStateChange = vi.fn((listener) => {
    state.authListener = listener;
    return { data: { subscription: { unsubscribe } } };
  });
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { state, getSession, signOut, unsubscribe, onAuthStateChange, single, eq, select, from };
});
const { getSession, signOut, unsubscribe, onAuthStateChange, single, eq, from } = mocks;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: mocks.getSession, onAuthStateChange: mocks.onAuthStateChange, signOut: mocks.signOut }, from: mocks.from },
}));

import { AuthProvider, useAuth } from './AuthContext';

const user = { id: 'user-1', email: 'student@example.test' };
const session = { user, access_token: 'token' };
const profileRow = {
  id: 'profile-1', user_id: 'user-1', email: 'student@example.test', full_name: 'Student', role: 'student',
  avatar_url: null, course_enrolled: null, custom_instructions: 'Use examples', created_at: 'now', updated_at: 'now',
};
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null } });
    single.mockResolvedValue({ data: profileRow, error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it('rejects useAuth outside its provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider');
    consoleError.mockRestore();
  });

  it('loads an anonymous session and unregisters its listener on unmount', async () => {
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('hydrates and maps a signed-in profile', async () => {
    getSession.mockResolvedValueOnce({ data: { session } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.profile?.id).toBe('profile-1'));
    expect(from).toHaveBeenCalledWith('profiles');
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result.current.profile).toMatchObject({ courseEnrolled: [], custom_instructions: 'Use examples' });
    expect(result.current.isStudent).toBe(true);
  });

  it('responds to sign-in/sign-out events and clears local state on explicit sign out', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => mocks.state.authListener?.('SIGNED_IN', session));
    await waitFor(() => expect(result.current.user?.id).toBe('user-1'));
    await waitFor(() => expect(result.current.profile?.id).toBe('profile-1'));

    await act(async () => result.current.signOut());
    expect(signOut).toHaveBeenCalledOnce();
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();

    act(() => mocks.state.authListener?.('SIGNED_OUT', null));
    expect(result.current.session).toBeNull();
  });

  it('refreshes the current profile and tolerates profile query failures', async () => {
    getSession.mockResolvedValueOnce({ data: { session } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    single.mockResolvedValueOnce({ data: null, error: { message: 'missing' } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => result.current.refreshProfile());
    expect(result.current.profile).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
