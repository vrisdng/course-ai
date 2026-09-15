import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { OtherViewer } from './OtherViewer';

const source = (overrides: Partial<ActiveViewerSource>): ActiveViewerSource => ({
  kind: 'other',
  documentName: 'deck.pptx',
  signedUrl: 'https://files.test/deck.pptx',
  materialId: 'mat-1',
  excerpt: '',
  ...overrides,
});

describe('OtherViewer', () => {
  it('offers to open in a new tab and download when a signed url exists', () => {
    const onClose = vi.fn();
    render(<OtherViewer source={source()} onClose={onClose} />);
    expect(screen.getByRole('link', { name: /open in new tab/i })).toHaveAttribute('href', 'https://files.test/deck.pptx');
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('href', 'https://files.test/deck.pptx');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('omits the open/download links when there is no signed url', () => {
    render(<OtherViewer source={source({ signedUrl: null })} onClose={vi.fn()} />);
    expect(screen.queryByRole('link', { name: /open in new tab/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('labels the file type from its extension', () => {
    render(<OtherViewer source={source()} onClose={vi.fn()} />);
    expect(screen.getByText(/PPTX files can’t be previewed/)).toBeInTheDocument();
  });
});
