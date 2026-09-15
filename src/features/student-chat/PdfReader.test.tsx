import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { PdfReader } from './PdfReader';

const state = vi.hoisted(() => ({ numPages: 3 }));

vi.mock('react-pdf', () => ({
  Document: ({
    children,
    onLoadSuccess,
  }: {
    children?: React.ReactNode;
    onLoadSuccess?: (meta: { numPages: number }) => void;
  }) => {
    queueMicrotask(() => onLoadSuccess?.({ numPages: state.numPages }));
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
    pageNumber: 2,
    signedUrl: 'https://pdf.test/notes.pdf',
    materialId: 'mat-1',
    excerpt: 'cited passage',
    ...overrides,
  };
}

class MockResizeObserver {
  cb: () => void = () => undefined;
  observe(_element: Element) {
    this.cb();
  }
  unobserve() {}
  disconnect() {}
}

describe('PdfReader', () => {
  beforeEach(() => {
    state.numPages = 3;
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(window, 'ResizeObserver', { value: MockResizeObserver, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: () => undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: () => undefined,
      configurable: true,
      writable: true,
    });
  });

  it('renders the page counter, thumbnails, and starts at the cited page', async () => {
    render(<PdfReader source={source()} />);
    await screen.findByText(/Page 2 \/ 3/);

    expect(screen.getByLabelText('Page 1')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Page 2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Page 3')).toHaveAttribute('aria-pressed', 'false');
  });

  it('navigates with the prev/next controls and clamps at the ends', async () => {
    render(<PdfReader source={source({ pageNumber: 1 })} />);
    await screen.findByText(/Page 1 \/ 3/);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText(/Page 2 \/ 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText(/Page 3 \/ 3/);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await screen.findByText(/Page 1 \/ 3/);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('jumps to a page when its thumbnail is tapped', async () => {
    render(<PdfReader source={source()} />);
    await screen.findByText(/Page 2 \/ 3/);
    fireEvent.click(screen.getByLabelText('Page 3'));
    expect(screen.getByText(/Page 3 \/ 3/)).toBeInTheDocument();
    expect(screen.getByLabelText('Page 3')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a placeholder when there is no signed URL', async () => {
    render(<PdfReader source={source({ signedUrl: undefined })} />);
    expect(await screen.findByText(/No document available to preview/i)).toBeInTheDocument();
  });

  it('divides pages into slices of 7 and navigates slices', async () => {
    state.numPages = 8;
    render(<PdfReader source={source({ pageNumber: 1 })} />);
    await screen.findByText(/Page 1 \/ 8/);

    expect(screen.getByText(/Slice 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByLabelText('Page 7')).toBeInTheDocument();
    expect(screen.queryByLabelText('Page 8')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next slice' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next slice' }));
    await screen.findByText(/Page 8 \/ 8/);
    expect(screen.getByText(/Slice 2 \/ 2/)).toBeInTheDocument();
    expect(screen.getByLabelText('Page 8')).toBeInTheDocument();
    expect(screen.queryByLabelText('Page 7')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next slice' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous slice' }));
    await screen.findByText(/Page 1 \/ 8/);
    expect(screen.getByRole('button', { name: 'Previous slice' })).toBeDisabled();
  });
});
