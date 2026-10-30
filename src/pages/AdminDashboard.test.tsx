import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn((_table: string) => ({ select: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) })) })),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'p1', role: 'admin' }, user: { id: 'u1' } }) }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/lecturer/CoursesOverviewTab', () => ({ CoursesOverviewTab: () => null }));
vi.mock('@/components/lecturer/MaterialsTab', () => ({ MaterialsTab: () => null }));
vi.mock('@/features/chat-settings/CourseChatSettingsPanel', () => ({ CourseChatSettingsPanel: () => null }));
vi.mock('@/components/lecturer/SystemMaintenancePanel', () => ({ SystemMaintenancePanel: () => null }));
import AdminDashboard from './AdminDashboard';

describe('AdminDashboard course loading', () => {
  it('loads courses and terms without querying the retired invitation table', async () => {
    render(<AdminDashboard />);
    await waitFor(() => expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['courses', 'academic_terms']));
  });
});
