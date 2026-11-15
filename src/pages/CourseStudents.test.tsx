import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
import CourseStudents from './CourseStudents';

const enrollments = [
  { id: 'e1', user_id: 'u1', enrolled_at: '2026-01-02T00:00:00Z' },
  { id: 'e2', user_id: 'u2', enrolled_at: '2026-02-03T00:00:00Z' },
];
const profiles = [
  { user_id: 'u1', full_name: 'Ada Lovelace', email: 'ada@example.test' },
  { user_id: 'u2', full_name: 'Grace Hopper', email: 'grace@example.test' },
];

function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'maybeSingle', 'in', 'delete']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const defaultCounts = [{ user_id: 'u1', question_count: 3, last_question_at: '2026-11-14T08:00:00Z' }];

function arrange(options: {
  enrollmentError?: string; profileError?: string; deleteError?: string; rows?: typeof enrollments;
  counts?: typeof defaultCounts; countsError?: string;
} = {}) {
  mocks.rpc.mockResolvedValue(options.countsError
    ? { data: null, error: { message: options.countsError } }
    : { data: options.counts ?? defaultCounts, error: null });
  const courseQuery = query({ data: { name: 'Algorithms', code: 'CS101' }, error: null });
  const enrollmentQuery = query({ data: options.rows ?? enrollments, error: options.enrollmentError ? { message: options.enrollmentError } : null });
  const profileQuery = query({ data: profiles, error: options.profileError ? { message: options.profileError } : null });
  const deleteQuery = query({ error: options.deleteError ? { message: options.deleteError } : null });
  mocks.from.mockImplementation((table: string) => table === 'courses' ? courseQuery : table === 'profiles' ? profileQuery :
    mocks.from.mock.calls.filter(([name]) => name === 'enrollments').length > 1 ? deleteQuery : enrollmentQuery);
  return { courseQuery, enrollmentQuery, profileQuery, deleteQuery };
}

const renderPage = () => render(<MemoryRouter initialEntries={['/courses/c1/students']}><Routes>
  <Route path="/courses/:courseId/students" element={<CourseStudents />} />
</Routes></MemoryRouter>);

describe('CourseStudents', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); });

  it('merges enrollment/profile data and filters the visible roster', async () => {
    arrange(); renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('Students enrolled in Algorithms (CS101).')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search by name or email...'), { target: { value: 'ada@' } });
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });

  it('bulk removes only students visible under the current search', async () => {
    const { deleteQuery } = arrange(); renderPage();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all students' }));
    fireEvent.change(screen.getByPlaceholderText('Search by name or email...'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Un-enroll 1 selected' }));
    await waitFor(() => expect(deleteQuery.in).toHaveBeenCalledWith('id', ['e1']));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Student un-enrolled');
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('supports per-student removal cancellation and reports deletion errors', async () => {
    arrange({ deleteError: 'permission denied' }); renderPage();
    await screen.findByText('Ada Lovelace');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Un-enroll Ada Lovelace' }));
    expect(mocks.from).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Un-enroll Ada Lovelace' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('permission denied'));
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('shows empty, search-empty, and load-error states', async () => {
    arrange({ rows: [] }); const { unmount } = renderPage();
    expect(await screen.findByText('No students enrolled yet.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all students' })).toBeDisabled();
    unmount();

    vi.clearAllMocks(); arrange({ enrollmentError: 'load failed' }); renderPage();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('load failed'));
  });

  it('shows how many questions each student asked and when they last asked, without question text', async () => {
    arrange(); renderPage();
    await screen.findByText('Ada Lovelace');
    expect(mocks.rpc).toHaveBeenCalledWith('get_course_student_question_counts', { in_course_id: 'c1' });

    const ada = screen.getByText('Ada Lovelace').closest('tr') as HTMLTableRowElement;
    expect(within(ada).getByText('3')).toHaveAttribute('data-label', 'Questions');
    expect(within(ada).getByText(new Date('2026-11-14T08:00:00Z').toLocaleDateString())).toHaveAttribute('data-label', 'Last asked');

    const grace = screen.getByText('Grace Hopper').closest('tr') as HTMLTableRowElement;
    expect(within(grace).getByText('0')).toHaveAttribute('data-label', 'Questions');
    expect(within(grace).getByText('Never')).toHaveAttribute('data-label', 'Last asked');
  });

  it('sorts the roster by question count from the column header', async () => {
    arrange({ counts: [
      { user_id: 'u1', question_count: 1, last_question_at: '2026-11-14T08:00:00Z' },
      { user_id: 'u2', question_count: 5, last_question_at: '2026-11-13T08:00:00Z' },
    ] });
    renderPage();
    await screen.findByText('Ada Lovelace');
    const names = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[1].textContent);

    expect(names()).toEqual(['Ada Lovelace', 'Grace Hopper']);
    fireEvent.click(screen.getByRole('button', { name: /Questions/ }));
    expect(names()).toEqual(['Grace Hopper', 'Ada Lovelace']);
    fireEvent.click(screen.getByRole('button', { name: /Questions/ }));
    expect(names()).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('keeps the roster usable when question counts fail to load', async () => {
    arrange({ countsError: 'Access denied' }); renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Could not load question counts: Access denied'));
    const ada = screen.getByText('Ada Lovelace').closest('tr') as HTMLTableRowElement;
    expect(within(ada).getAllByText('—')).toHaveLength(2);
  });

  it('stacks each roster row into a labelled card below the sm breakpoint', async () => {
    arrange(); renderPage();
    await screen.findByText('Ada Lovelace');
    expect(screen.getByRole('columnheader', { name: 'Enrolled' }).closest('thead')?.className).toContain('hidden');
    const row = screen.getByText('Ada Lovelace').closest('tr') as HTMLTableRowElement;
    expect(row.className).toContain('sm:table-row');
    const email = within(row).getByText('ada@example.test');
    expect(email).toHaveAttribute('data-label', 'Email');
    expect(email.className).toContain('sm:table-cell');
    expect(within(row).getByText(new Date('2026-01-02T00:00:00Z').toLocaleDateString())).toHaveAttribute('data-label', 'Enrolled');
  });
});
