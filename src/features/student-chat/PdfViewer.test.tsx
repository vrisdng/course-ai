import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { PdfViewer } from './PdfViewer';

vi.mock('react-pdf', () => ({
  Document: ({
    children,
    onLoadSuccess,
  }: {
    children?: React.ReactNode;
    onLoadSuccess?: (meta: { numPages: number }) => void;
  }) => {
    onLoadSuccess?.({ numPages: 3 });
    return <div data-testid="pdf-doc">{children}</div>;
  },
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
    pageNumber: 4,
    signedUrl: 'https://pdf.test/notes.pdf',
    materialId: 'mat-1',
    excerpt: 'cited passage',
    ...overrides,
  };
}

// jsdom has no ResizeObserver; drive the measure pass so the canvas renders.
class MockResizeObserver {
  cb: () => void = () => undefined;
  observe(_element: Element) {
    this.cb();
  }
  unobserve() {}
  disconnect() {}
}

describe('PdfViewer', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'ResizeObserver', { value: MockResizeObserver, configurable: true });
  });

  it('renders the page counter, nav controls, and cited excerpt', () => {
    render(<PdfViewer source={source({ pageNumber: 4 })} onClose={vi.fn()} />);
    expect(screen.getByText(/Page 4 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText('“cited passage”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
  });

  it('draws a yellow ring around the page canvas', () => {
    const { container } = render(<PdfViewer source={source({})} onClose={vi.fn()} />);
    expect(container.querySelector('[data-testid="pdf-highlight"]')?.className).toContain('border-yellow-400');
  });

  it('navigates to the next page and stops at the last page', () => {
    render(<PdfViewer source={source({ pageNumber: 2 })} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByTestId('pdf-page')).toHaveTextContent('Page 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText(/Page 3 \/ 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('navigates to the previous page and stops at the first page', () => {
    render(<PdfViewer source={source({ pageNumber: 2 })} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByTestId('pdf-page')).toHaveTextContent('Page 1');
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('renders the page in a centered, scrollable area so it stays stable across navigations', () => {
    const { container } = render(<PdfViewer source={source()} onClose={vi.fn()} />);
    const area = container.querySelector('[class*="overflow-auto"]');
    expect(area).toBeInTheDocument();
    expect(area?.className).toContain('items-center');
    expect(area?.className).toContain('min-h-0');
  });
});
