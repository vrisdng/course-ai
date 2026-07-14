import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  rpc: vi.fn(),
  invoke: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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
    functions: { invoke: mocks.invoke },
    from: vi.fn(() => ({ update: mocks.update })),
  },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import Settings from './Settings';

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = {
      profile: { id: 'p1', email: 'student@example.test', full_name: 'Ada', custom_instructions: 'Use examples' },
      refreshProfile: vi.fn().mockResolvedValue(undefined),
      isLoading: false,
      isAdmin: false,
    };
    mocks.rpc.mockResolvedValue({ data: [{ id: 'c1', name: 'Algorithms', code: 'CS101', access_role: 'student' }], error: null });
    mocks.eq.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.invoke.mockResolvedValue({ data: { status: 'enrolled' }, error: null });
  });

  it('loads profile data and persists edited profile fields', async () => {
    render(<Settings />);
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

  it('lists accessible courses and enrolls using a normalized invite code', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [{ id: 'c1', name: 'Algorithms', code: 'CS101', access_role: 'student' }], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'c2', name: 'Databases', code: 'DB201', access_role: 'student' }], error: null });
    render(<Settings />);
    fireEvent.click(screen.getByRole('tab', { name: 'Courses' }));
    expect(await screen.findByText('Algorithms')).toBeInTheDocument();
    expect(screen.getByText('CS101')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Course Invite Code'), { target: { value: ' abc-123 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enroll' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('redeem-course-invite', { body: { inviteCode: 'ABC-123' } }));
    expect(await screen.findByText('Databases')).toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Successfully enrolled!');
    expect(screen.getByPlaceholderText('Course Invite Code')).toHaveValue('');
  });

  it('reports provider errors and hides enrollment controls from admins', async () => {
    mocks.invoke.mockResolvedValue({ data: { error: 'Invite expired' }, error: null });
    const { unmount } = render(<Settings />);
    fireEvent.click(screen.getByRole('tab', { name: 'Courses' }));
    await screen.findByText('Algorithms');
    fireEvent.change(screen.getByPlaceholderText('Course Invite Code'), { target: { value: 'OLD' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Course Invite Code'), { key: 'Enter' });
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Invite expired'));
    unmount();

    mocks.auth = { ...mocks.auth, isAdmin: true };
    render(<Settings />);
    fireEvent.click(screen.getByRole('tab', { name: 'Courses' }));
    await screen.findByText('Algorithms');
    expect(screen.queryByPlaceholderText('Course Invite Code')).not.toBeInTheDocument();
  });

  it('shows the page loading state and handles course/profile failures', async () => {
    mocks.auth = { ...mocks.auth, isLoading: true };
    const { container, unmount } = render(<Settings />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    unmount();

    mocks.auth = { ...mocks.auth, isLoading: false };
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'course failure' } });
    mocks.eq.mockResolvedValue({ error: { message: 'save failure' } });
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('save failure'));
  });
});
