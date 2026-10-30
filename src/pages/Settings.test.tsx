import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  rpc: vi.fn(),
  invoke: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/ui/tabs', async () => {
  const React = await import('react');
  const TabContext = React.createContext({ value: '', setValue: (_value: string) => {} });
  return {
    Tabs: ({ defaultValue, children }: { defaultValue: string; children: React.ReactNode }) => {
      const [value, setValue] = React.useState(defaultValue);
      return <TabContext.Provider value={{ value, setValue }}><div>{children}</div></TabContext.Provider>;
    },
    TabsList: ({ children }: { children: React.ReactNode }) => <div role="tablist">{children}</div>,
    TabsTrigger: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const tabs = React.useContext(TabContext);
      return <button role="tab" aria-selected={tabs.value === value} onClick={() => tabs.setValue(value)}>{children}</button>;
    },
    TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const tabs = React.useContext(TabContext);
      return tabs.value === value ? <div role="tabpanel">{children}</div> : null;
    },
  };
});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
    functions: { invoke: mocks.invoke },
    from: vi.fn(() => ({ update: mocks.update })),
  },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import Settings from './Settings';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}</div>;
}

const renderSettings = () => render(
  <MemoryRouter initialEntries={['/settings']}>
    <Routes>
      <Route path="/settings" element={<Settings />} />
      <Route path="/reset-password" element={<LocationProbe />} />
    </Routes>
  </MemoryRouter>
);

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = {
      user: { email: 'student@example.test' },
      profile: { id: 'p1', email: 'student@example.test', full_name: 'Ada', custom_instructions: 'Use examples' },
      refreshProfile: vi.fn().mockResolvedValue(undefined),
      isLoading: false,
      isAdmin: false,
    };
    mocks.rpc.mockResolvedValue({ data: [{ id: 'c1', name: 'Algorithms', code: 'CS101', access_role: 'student' }], error: null });
    mocks.eq.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.invoke.mockResolvedValue({ data: { status: 'enrolled' }, error: null });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it('loads profile data and persists edited profile fields', async () => {
    renderSettings();
    const name = screen.getByPlaceholderText('Enter your name');
    expect(name).toHaveValue('Ada');
    fireEvent.change(name, { target: { value: 'Ada Lovelace' } });
    fireEvent.click(screen.getByRole('tab', { name: 'AI Preferences' }));
    const instructions = screen.getByPlaceholderText(/What would you like the AI/);
    expect(instructions).toHaveValue('Use examples');
    fireEvent.change(instructions, { target: { value: 'Explain with diagrams' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({
      full_name: 'Ada Lovelace', custom_instructions: 'Explain with diagrams',
    }));
    expect(mocks.eq).toHaveBeenCalledWith('id', 'p1');
    expect(mocks.auth.refreshProfile).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Profile saved successfully');
  });

  it.each([false, true])('lists accessible courses without self-enrollment controls (admin: %s)', async (isAdmin) => {
    mocks.auth.isAdmin = isAdmin;
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Courses' }));
    expect(await screen.findByText('Algorithms')).toBeInTheDocument();
    expect(screen.getByText('CS101')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Course Invite Code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enroll' })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('shows the page loading state and handles course/profile failures', async () => {
    mocks.auth = { ...mocks.auth, isLoading: true };
    const { container, unmount } = renderSettings();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    unmount();

    mocks.auth = { ...mocks.auth, isLoading: false };
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'course failure' } });
    mocks.eq.mockResolvedValue({ error: { message: 'save failure' } });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('save failure'));
  });

  it('uses the Auth email instead of a stale profile email and passes it in router state', async () => {
    mocks.auth = { ...mocks.auth, profile: { ...(mocks.auth.profile as Record<string, unknown>), email: 'stale@example.test' } };
    renderSettings();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('list_accessible_courses'));
    fireEvent.click(screen.getByRole('button', { name: 'Email me a reset code' }));
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('student@example.test'));
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      JSON.stringify({ pathname: '/reset-password', search: '', state: { email: 'student@example.test', requireRecoveryOtp: true, from: '/settings' } }),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('does not send a reset request without an account email', async () => {
    mocks.auth = { ...mocks.auth, user: { email: null } };
    renderSettings();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('list_accessible_courses'));
    expect(screen.getByRole('button', { name: 'Email me a reset code' })).toBeDisabled();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('shows recovery email errors and ignores duplicate submissions while sending', async () => {
    let finishRequest: ((value: { error: { message: string } | null }) => void) | undefined;
    mocks.resetPasswordForEmail.mockImplementation(() => new Promise((resolve) => { finishRequest = resolve; }));
    renderSettings();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('list_accessible_courses'));
    const button = screen.getByRole('button', { name: 'Email me a reset code' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    finishRequest?.({ error: { message: 'Email rate limit exceeded' } });
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Email rate limit exceeded'));
    expect(screen.getByRole('button', { name: 'Email me a reset code' })).toBeEnabled();
    expect(screen.queryByTestId('location-probe')).not.toBeInTheDocument();
  });
});
