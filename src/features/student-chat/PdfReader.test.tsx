import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { PdfReader, THUMBNAIL_WIDTH as THUMB } from './PdfReader';

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
  Page: ({
    pageNumber,
    width,
    onLoadSuccess,
  }: {
    pageNumber: number;
    width: number;
    onLoadSuccess?: (page: { originalWidth: number; originalHeight: number }) => void;
  }) => {
    queueMicrotask(() => onLoadSuccess?.({ originalWidth: 600, originalHeight: 800 }));
    return (
      <div data-testid="pdf-page" data-page={pageNumber} data-width={width}>
        Page {pageNumber}
      </div>
    );
  },
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}));

function source(overrides: Partial<ActiveViewerSource> = {}): ActiveViewerSource {
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
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { value: 432, configurable: true });
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

  const pageInput = () => screen.getByRole('spinbutton', { name: 'Page number' }) as HTMLInputElement;

  it('starts at the cited page, with every page as a thumbnail in the sidebar', async () => {
    render(<PdfReader source={source()} />);
    await screen.findByText('/ 3');

    expect(pageInput().value).toBe('2');
    const sidebar = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(sidebar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Page 1', 'Page 2', 'Page 3']);
    expect(screen.getByLabelText('Page 2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Slice/)).not.toBeInTheDocument();
  });

  it('shows all pages without slicing, however many there are', async () => {
    state.numPages = 12;
    render(<PdfReader source={source({ pageNumber: 1 })} />);
    await screen.findByText('/ 12');
    expect(screen.getByLabelText('Page 12')).toBeInTheDocument();
  });

  it('navigates with the prev/next controls and clamps at the ends', async () => {
    render(<PdfReader source={source({ pageNumber: 1 })} />);
    await screen.findByText('/ 3');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pageInput().value).toBe('3');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(pageInput().value).toBe('1');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('goes to the page typed into the page box', async () => {
    render(<PdfReader source={source({ pageNumber: 1 })} />);
    await screen.findByText('/ 3');

    fireEvent.change(pageInput(), { target: { value: '3' } });
    fireEvent.keyDown(pageInput(), { key: 'Enter' });
    expect(screen.getByLabelText('Page 3')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('pdf-page').find((p) => p.dataset.width === '300')?.dataset.page).toBe('3');
  });

  it('clamps out-of-range numbers and restores the page for anything that is not a number', async () => {
    render(<PdfReader source={source({ pageNumber: 2 })} />);
    await screen.findByText('/ 3');

    fireEvent.change(pageInput(), { target: { value: '99' } });
    fireEvent.blur(pageInput());
    expect(pageInput().value).toBe('3');

    fireEvent.change(pageInput(), { target: { value: '' } });
    fireEvent.blur(pageInput());
    expect(pageInput().value).toBe('3');
  });

  it('jumps to a page when its thumbnail is tapped', async () => {
    render(<PdfReader source={source()} />);
    await screen.findByText('/ 3');
    fireEvent.click(screen.getByLabelText('Page 3'));
    expect(pageInput().value).toBe('3');
    expect(screen.getByLabelText('Page 3')).toHaveAttribute('aria-pressed', 'true');
  });

  it('sizes the page to fit the available height so it never overflows', async () => {
    // 600x432 viewer minus 32px padding: a 3:4 page fits at 400px tall, so 300px wide.
    render(<PdfReader source={source()} />);
    await screen.findByText('/ 3');
    await waitFor(() => {
      const main = screen.getAllByTestId('pdf-page').find((p) => p.dataset.page === '2' && p.dataset.width !== String(THUMB));
      expect(main?.dataset.width).toBe('300');
    });
  });

  it('shows a placeholder when there is no signed URL', async () => {
    render(<PdfReader source={source({ signedUrl: undefined })} />);
    expect(await screen.findByText(/No document available to preview/i)).toBeInTheDocument();
  });
});
