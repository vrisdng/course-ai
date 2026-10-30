import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
import { ImportStudentsDialog } from './ImportStudentsDialog';

describe('ImportStudentsDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('previews emails, blocks invalid input and reports partial import results', async () => {
    const onImported = vi.fn();
    mocks.invoke.mockResolvedValue({ data: { results: [
      { email: 'ada@example.test', status: 'created' },
      { email: 'grace@example.test', status: 'failed', error: 'Retry enrollment' },
    ] }, error: null });
    render(<ImportStudentsDialog courseId="c1" onImported={onImported} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import students' }));
    fireEvent.change(screen.getByLabelText('Student emails'), { target: { value: 'invalid,ada@example.test' } });
    expect(screen.getByRole('button', { name: 'Import 1 student' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Student emails'), { target: { value: 'ada@example.test\ngrace@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 students' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('import-course-students', {
      body: { courseId: 'c1', students: [{ email: 'ada@example.test' }, { email: 'grace@example.test' }] },
    }));
    expect(await screen.findByText('Created and enrolled')).toBeInTheDocument();
    expect(screen.getByText('Retry enrollment')).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledOnce();
  });
  it('keeps completed batches visible if a later request fails', async () => {
    const onImported = vi.fn();
    mocks.invoke.mockResolvedValueOnce({ data: { results: [{ email: 's0@example.test', status: 'created' }] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Network unavailable' } });
    render(<ImportStudentsDialog courseId="c1" onImported={onImported} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import students' }));
    fireEvent.change(screen.getByLabelText('Student emails'), { target: { value: Array.from({ length: 21 }, (_, n) => `s${n}@example.test`).join(',') } });
    fireEvent.click(screen.getByRole('button', { name: 'Import 21 students' }));
    expect(await screen.findByText(/Network unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Created and enrolled')).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledOnce();
  });
  it('previews names from an uploaded CSV and sends named rows in batches of 20', async () => {
    mocks.invoke.mockResolvedValue({ data: { results: [] }, error: null });
    render(<ImportStudentsDialog courseId="c1" onImported={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import students' }));
    const csv = 'email,fullName\n' + Array.from({ length: 21 }, (_, n) => `s${n}@example.test,"Student, ${n}"`).join('\n');
    const file = new File([csv], 'named-students.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) });
    fireEvent.change(screen.getByLabelText('CSV or text file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import 21 students' })).toBeEnabled());
    expect(screen.getByRole('cell', { name: 'Student, 0' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import 21 students' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    const batches = mocks.invoke.mock.calls.map((call) => call[1].body.students);
    expect(batches.map((batch) => batch.length)).toEqual([20, 1]);
    expect(batches[0][0]).toEqual({ email: 's0@example.test', fullName: 'Student, 0' });
    expect(batches[1][0]).toEqual({ email: 's20@example.test', fullName: 'Student, 20' });
  });
  it('reads an uploaded email-only CSV into the preview', async () => {
    render(<ImportStudentsDialog courseId="c1" onImported={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import students' }));
    const file = new File(['email\nada@example.test'], 'students.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('email\nada@example.test') });
    fireEvent.change(screen.getByLabelText('CSV or text file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import 1 student' })).toBeEnabled());
    expect(screen.getByLabelText('Student emails')).toHaveValue('email\nada@example.test');
  });
});
