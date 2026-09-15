import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { PdfThumbnail } from './PdfThumbnail';

vi.mock('react-pdf', () => ({
  Document: ({ children }: { children?: React.ReactNode }) => <div data-testid="pdf-doc">{children}</div>,
  Page: ({ pageNumber, width }: { pageNumber: number; width: number }) => (
    <div data-testid="pdf-page" data-width={width}>
      Page {pageNumber}
    </div>
  ),
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}));

function source(overrides: Partial<ActiveViewerSource>): ActiveViewerSource {
  return {
    kind: 'pdf',
    documentName: 'Lecture Notes',
    pageNumber: 3,
    signedUrl: 'https://pdf.test/notes.pdf',
    ...overrides,
  };
}

describe('PdfThumbnail', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      value: { observe() {}, unobserve() {}, disconnect() {} },
      configurable: true,
    });
  });

  it('renders the page canvas at the requested width', () => {
    render(<PdfThumbnail source={source()} pageNumber={3} width={200} />);
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-width', '200');
  });

  it('hugs the page (w-auto, clickable) in preview mode instead of stretching full width', () => {
    const { rerender } = render(<PdfThumbnail source={source()} pageNumber={3} width={200} />);
    const baseButton = screen.getByRole('button', { name: 'Page 3' });
    expect(baseButton.className).not.toContain('w-auto');

    rerender(<PdfThumbnail source={source()} pageNumber={3} width={200} preview />);
    const previewButton = screen.getByRole('button', { name: 'Page 3' });
    expect(previewButton.className).toContain('w-auto');
    expect(previewButton.className).toContain('cursor-pointer');
    expect(previewButton.className).not.toContain('w-full');
  });

  it('invokes onClick when previewed and tapped', () => {
    const onClick = vi.fn();
    render(<PdfThumbnail source={source()} pageNumber={3} width={200} preview onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('invokes onClick on a regular thumbnail too', () => {
    const onClick = vi.fn();
    render(<PdfThumbnail source={source()} pageNumber={3} width={200} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
