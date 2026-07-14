import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Material } from '@/features/materials/types';
import { EditFileNameDialog } from './EditFileNameDialog';
import { EnrollmentCodeDialog } from './EnrollmentCodeDialog';
import { LinkedUrlDialog } from './LinkedUrlDialog';
import { TranscriptDialog } from './TranscriptDialog';

const material = {
  id: 'm1', course_id: 'c1', file_name: 'Lecture.mp4', file_path: 'lecture.mp4', file_type: 'video',
  file_size: 100, linked_url: null, topic: null, week_number: null, processing_status: 'completed',
  access_scope: 'course', academic_term_id: 't1', created_at: '2026-01-01',
} as Material;

describe('lecturer material dialogs', () => {
  it('edits, opens, saves, and closes an attached URL', () => {
    const onValueChange = vi.fn(); const onSave = vi.fn(); const onClose = vi.fn();
    render(<LinkedUrlDialog material={material} value=" https://example.test/video " isSaving={false}
      onValueChange={onValueChange} onSave={onSave} onClose={onClose} />);
    expect(screen.getByText(/attached to "Lecture.mp4"/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open url/i });
    expect(link).toHaveAttribute('href', 'https://example.test/video');
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://new.test' } });
    expect(onValueChange).toHaveBeenCalledWith('https://new.test');
    fireEvent.click(screen.getByRole('button', { name: 'Save URL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });

  it('disables URL controls and shows saving state while persistence is active', () => {
    render(<LinkedUrlDialog material={material} value="" isSaving onValueChange={vi.fn()} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('URL')).toBeDisabled();
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('saves filenames by button or Enter and disables controls while saving', () => {
    const onSave = vi.fn(); const onValueChange = vi.fn();
    const { rerender } = render(<EditFileNameDialog material={material} value="Lecture.mp4" isSaving={false}
      onValueChange={onValueChange} onSave={onSave} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Filename');
    fireEvent.change(input, { target: { value: 'Renamed.mp4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save Filename' }));
    expect(onValueChange).toHaveBeenCalledWith('Renamed.mp4'); expect(onSave).toHaveBeenCalledTimes(2);
    rerender(<EditFileNameDialog material={material} value="Renamed.mp4" isSaving onValueChange={onValueChange} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Filename')).toBeDisabled();
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });

  it('renders transcript loading, empty, and timestamped paragraph states', () => {
    const props = { material, onClose: vi.fn() };
    const { rerender } = render(<TranscriptDialog {...props} segments={[]} isLoading />);
    expect(screen.getByText('Loading transcript...')).toBeInTheDocument();
    rerender(<TranscriptDialog {...props} segments={[]} isLoading={false} />);
    expect(screen.getByText(/No transcript segments/)).toBeInTheDocument();
    rerender(<TranscriptDialog {...props} isLoading={false} segments={[
      { id: 's1', segment_index: 0, start_ms: 1_000, end_ms: 3_000, text: 'Welcome.' },
    ]} />);
    expect(screen.getByText('0:01–0:03')).toBeInTheDocument();
    expect(screen.getByText('Welcome.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('generates, copies, and regenerates enrollment codes across dialog states', () => {
    const onGenerateCode = vi.fn(); const onCopyCode = vi.fn(); const course = { id: 'c1', name: 'Algorithms', code: 'CS101' };
    const { rerender } = render(<EnrollmentCodeDialog course={course} code={null} expiresAt={null} isLoading={false}
      isGenerating={false} onClose={vi.fn()} onCopyCode={onCopyCode} onGenerateCode={onGenerateCode} />);
    expect(screen.getByText(/No enrollment code exists/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Code' }));
    expect(onGenerateCode).toHaveBeenCalledTimes(1);
    rerender(<EnrollmentCodeDialog course={course} code="ABC123" expiresAt="2026-08-01T00:00:00Z" isLoading={false}
      isGenerating={false} onClose={vi.fn()} onCopyCode={onCopyCode} onGenerateCode={onGenerateCode} />);
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByText(/Expires/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Code' }));
    expect(onCopyCode).toHaveBeenCalledWith('ABC123'); expect(onGenerateCode).toHaveBeenCalledTimes(2);
  });
});
