import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentScopeSelector } from './DocumentScopeSelector';

const documents = [
  { id: 'd1', name: 'Lecture.pdf', type: 'pdf' }, { id: 'd2', name: 'Recording.mp4', type: 'video' },
];
const callbacks = () => ({ onSelectAllDocuments: vi.fn(), onClearSelection: vi.fn(), onApplySelection: vi.fn() });
describe('DocumentScopeSelector', () => {
  it('disables selection while loading or when no documents exist', () => {
    const cb = callbacks(); const { rerender } = render(<DocumentScopeSelector documents={[]} selectedDocumentIds={[]} isLoading={false} {...cb} />);
    expect(screen.getByRole('button', { name: /No processed documents/ })).toBeDisabled();
    rerender(<DocumentScopeSelector documents={documents} selectedDocumentIds={[]} isLoading {...cb} />);
    expect(screen.getByRole('button', { name: /Loading documents/ })).toBeDisabled();
  });
  it('applies all, none, and partial draft selections through distinct callbacks', async () => {
    const cb = callbacks(); const { rerender } = render(<DocumentScopeSelector documents={documents} selectedDocumentIds={[]} isLoading={false} {...cb} />);
    fireEvent.click(screen.getByRole('button', { name: /No documents selected/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(cb.onSelectAllDocuments).toHaveBeenCalled();

    rerender(<DocumentScopeSelector documents={documents} selectedDocumentIds={documents.map((d) => d.id)} isLoading={false} {...cb} />);
    fireEvent.click(screen.getByRole('button', { name: /All materials selected/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(cb.onClearSelection).toHaveBeenCalled();

    rerender(<DocumentScopeSelector documents={documents} selectedDocumentIds={[]} isLoading={false} {...cb} />);
    fireEvent.click(screen.getByRole('button', { name: /No documents selected/ }));
    fireEvent.click(screen.getByRole('button', { name: /Select Lecture\.pdf/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(cb.onApplySelection).toHaveBeenCalledWith(['d1']);
  });
  it('supports keyboard toggling and discards draft changes on cancel', () => {
    const cb = callbacks(); render(<DocumentScopeSelector documents={documents} selectedDocumentIds={['d1']} isLoading={false} {...cb} />);
    fireEvent.click(screen.getByRole('button', { name: /1 material selected/ }));
    fireEvent.keyDown(screen.getByRole('button', { name: /Select Recording\.mp4/ }), { key: 'Enter' });
    expect(screen.getByText('Using all course documents')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cb.onApplySelection).not.toHaveBeenCalled();
  });
});
