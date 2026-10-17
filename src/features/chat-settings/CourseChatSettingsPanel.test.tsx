import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from './chatSettingsForm';

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
  save: vi.fn(),
}));
vi.mock('./useCourseChatSettings', () => ({ useCourseChatSettings: mocks.hook }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) => (
    <select aria-label={value?.startsWith('c') ? 'Course' : 'Default model'} value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { CourseChatSettingsPanel } from './CourseChatSettingsPanel';

const courses = [
  { id: 'c1', name: 'Data Structures', code: 'CS2040' },
  { id: 'c2', name: 'Operating Systems', code: null },
];

function mockSettings(settings: ChatSettings | null, extra: Record<string, unknown> = {}) {
  mocks.hook.mockReturnValue({ settings, isLoading: false, isSaving: false, loadError: null, save: mocks.save, ...extra });
}

const renderPanel = () => render(<CourseChatSettingsPanel courses={courses} isLoadingCourses={false} userId="admin-1" />);

describe('CourseChatSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue(true);
    mockSettings({ ...DEFAULT_CHAT_SETTINGS, allowedModelTiers: [...DEFAULT_CHAT_SETTINGS.allowedModelTiers] });
  });

  it('loads the first course and switches courses', () => {
    renderPanel();
    expect(mocks.hook).toHaveBeenLastCalledWith('c1', 'admin-1');
    fireEvent.change(screen.getByLabelText('Course'), { target: { value: 'c2' } });
    expect(mocks.hook).toHaveBeenLastCalledWith('c2', 'admin-1');
  });

  it('shows the stored values', () => {
    mockSettings({ ...DEFAULT_CHAT_SETTINGS, finalCount: 6, videoSpreadWindowMs: 30_000, courseInstructions: 'Use SI units.' });
    renderPanel();
    expect(screen.getByRole('spinbutton', { name: 'Sources sent to the model' })).toHaveValue(6);
    expect(screen.getByRole('spinbutton', { name: 'Video summary spread window' })).toHaveValue(30);
    expect(screen.getByLabelText('Course instructions')).toHaveValue('Use SI units.');
  });

  it('saves only after a change', async () => {
    renderPanel();
    const saveButton = screen.getByRole('button', { name: 'Save changes' });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sources sent to the model' }), { target: { value: '7' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Video summary spread window' }), { target: { value: '45' } });
    fireEvent.click(screen.getByLabelText('Rewrite follow-up questions before searching'));
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ finalCount: 7, videoSpreadWindowMs: 45_000, queryRewriteEnabled: false }),
    );
  });

  it('blocks saving an out-of-range value and says why', () => {
    renderPanel();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sources sent to the model' }), { target: { value: '99' } });
    expect(screen.getByText('Must be between 1 and 30.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('requires an allowed default model tier', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Fast'));
    expect(screen.getByText('The default must be one of the allowed models.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'smart' } });
    expect(screen.queryByText('The default must be one of the allowed models.')).not.toBeInTheDocument();
  });

  it('resets the form to the defaults and discards edits', () => {
    mockSettings({ ...DEFAULT_CHAT_SETTINGS, finalCount: 6 });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByRole('spinbutton', { name: 'Sources sent to the model' })).toHaveValue(DEFAULT_CHAT_SETTINGS.finalCount);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('spinbutton', { name: 'Sources sent to the model' })).toHaveValue(6);
  });

  it('gives every numeric setting a slider that tracks the typed value', () => {
    mockSettings({ ...DEFAULT_CHAT_SETTINGS, finalCount: 6, videoSpreadWindowMs: 30_000 });
    renderPanel();

    const sources = screen.getByRole('slider', { name: 'Sources sent to the model' });
    expect(sources).toHaveAttribute('aria-valuenow', '6');
    expect(sources).toHaveAttribute('aria-valuemin', '1');
    expect(sources).toHaveAttribute('aria-valuemax', '30');
    // Shown in seconds, like the number box.
    expect(screen.getByRole('slider', { name: 'Video summary spread window' })).toHaveAttribute('aria-valuenow', '30');
    expect(screen.getAllByRole('slider')).toHaveLength(screen.getAllByRole('spinbutton').length);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sources sent to the model' }), { target: { value: '12' } });
    expect(sources).toHaveAttribute('aria-valuenow', '12');
  });

  it('updates the value and enables saving when a slider moves', () => {
    renderPanel();
    const slider = screen.getByRole('slider', { name: 'Similarity threshold' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(screen.getByRole('spinbutton', { name: 'Similarity threshold' })).toHaveValue(0.21);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    // Snapped to the step, not 0.21000000000000002.
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ matchThreshold: 0.21 }));
  });

  it('shows load errors and the empty state', () => {
    mockSettings(null, { loadError: 'denied' });
    const { unmount } = renderPanel();
    expect(screen.getByText('Could not load chat settings: denied')).toBeInTheDocument();
    unmount();

    render(<CourseChatSettingsPanel courses={[]} isLoadingCourses={false} userId="admin-1" />);
    expect(screen.getByText('Create a course first to configure its chat.')).toBeInTheDocument();
  });
});
