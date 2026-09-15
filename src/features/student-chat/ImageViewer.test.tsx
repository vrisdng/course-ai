import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { ImageViewer } from './ImageViewer';

const source = (overrides: Partial<ActiveViewerSource>): ActiveViewerSource => ({
  kind: 'image',
  documentName: 'diagram.png',
  signedUrl: 'https://img.test/diagram.png',
  materialId: 'mat-1',
  excerpt: 'diagram',
  ...overrides,
});

describe('ImageViewer', () => {
  it('renders the signed image', () => {
    render(<ImageViewer source={source()} onClose={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://img.test/diagram.png');
  });

  it('shows an unavailable state when there is no signed url', () => {
    render(<ImageViewer source={source({ signedUrl: null })} onClose={vi.fn()} />);
    expect(screen.getByText(/Image unavailable/)).toBeInTheDocument();
  });
});
