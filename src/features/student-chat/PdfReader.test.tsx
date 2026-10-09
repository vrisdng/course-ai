import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { PdfReader, THUMBNAIL_WIDTH as THUMB } from './PdfReader';

const state = vi.hoisted(() => ({
  numPages: 3,
  pageTexts: ['Intro page', 'Linear probing here', 'More probing and probing'] as string[],
}));

vi.mock('react-pdf', () => ({
  Document: ({
    children,
    onLoadSuccess,
    file,
  }: {
    children?: React.ReactNode;
    file?: { url: string };
    onLoadSuccess?: (pdf: { numPages: number; getPage: (n: number) => Promise<unknown> }) => void;
  }) => {
    // Like react-pdf, render the pages only once the document has loaded.
    const [loaded, setLoaded] = useState(false);
    // Read through a ref so the load runs once, like a real document load.
    const onLoadRef = useRef(onLoadSuccess);
    onLoadRef.current = onLoadSuccess;
    useEffect(() => {
      queueMicrotask(() => {
        onLoadRef.current?.({
          numPages: state.numPages,
          getPage: async (n: number) => ({
            getTextContent: async () => ({ items: [{ str: state.pageTexts[n - 1] ?? '' }] }),
          }),
        });
        setLoaded(true);
      });
    }, []);
    return <div data-testid="pdf-doc" data-file={file?.url}>{loaded ? children : 'Loading document…'}</div>;
  },
  Page: ({
    pageNumber,
    width,
    onLoadSuccess,
    renderTextLayer,
    customTextRenderer,
  }: {
    pageNumber: number;
    width: number;
    onLoadSuccess?: (page: { originalWidth: number; originalHeight: number }) => void;
    renderTextLayer?: boolean;
    customTextRenderer?: (item: { str: string; pageNumber: number; itemIndex: number }) => string;
  }) => {
    queueMicrotask(() => onLoadSuccess?.({ originalWidth: 600, originalHeight: 800 }));
    return (
      <div data-testid="pdf-page" data-page={pageNumber} data-width={width}>
        Page {pageNumber}
        {renderTextLayer && customTextRenderer ? (
          <span
            data-testid="text-layer"
            dangerouslySetInnerHTML={{ __html: customTextRenderer({ str: state.pageTexts[pageNumber - 1] ?? '', pageNumber, itemIndex: 0 }) }}
          />
        ) : null}
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

const cache = vi.hoisted(() => ({ getCachedPdf: vi.fn() }));
vi.mock('./pdfCache', () => ({ getCachedPdf: (...args: unknown[]) => cache.getCachedPdf(...args) }));

const scrolledTo: number[] = [];
const mainPages = () => screen.getAllByTestId('pdf-page').filter((p) => p.dataset.width !== String(THUMB));

describe('PdfReader', () => {
  beforeEach(() => {
    state.numPages = 3;
    state.pageTexts = ['Intro page', 'Linear probing here', 'More probing and probing'];
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { value: 432, configurable: true });
    Object.defineProperty(window, 'ResizeObserver', { value: MockResizeObserver, configurable: true });
    scrolledTo.length = 0;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value(this: HTMLElement) {
        if (this.dataset.pageAnchor) scrolledTo.push(Number(this.dataset.pageAnchor));
      },
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
    expect(scrolledTo.at(-1)).toBe(3);
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
    expect(scrolledTo.at(-1)).toBe(3);
  });

  it('shows every page in one continuous scroll, opening at the cited page', async () => {
    render(<PdfReader source={source()} />);
    await screen.findByText('/ 3');
    await waitFor(() => expect(mainPages().map((p) => p.dataset.page)).toEqual(['1', '2', '3']));
    await waitFor(() => expect(scrolledTo).toContain(2));
  });

  it('follows the page being looked at while scrolling', async () => {
    render(<PdfReader source={source({ pageNumber: 1 })} />);
    await screen.findByText('/ 3');
    const scroller = screen.getByTestId('pdf-scroll');
    const anchors = [...scroller.querySelectorAll<HTMLElement>('[data-page-anchor]')];
    anchors.forEach((anchor, index) => Object.defineProperty(anchor, 'offsetTop', { value: index * 432, configurable: true }));

    Object.defineProperty(scroller, 'scrollTop', { value: 2 * 432 + 10, configurable: true });
    fireEvent.scroll(scroller);
    expect(pageInput().value).toBe('3');
    expect(screen.getByLabelText('Page 3')).toHaveAttribute('aria-pressed', 'true');
  });

  it('sizes the page to fit the available height so it never overflows', async () => {
    // 600x432 viewer minus 32px padding: a 3:4 page fits at 400px tall, so 300px wide.
    render(<PdfReader source={source()} />);
    await screen.findByText('/ 3');
    await waitFor(() => expect(mainPages().map((p) => p.dataset.width)).toEqual(['300', '300', '300']));
  });

  it('reads the cached download, not the citation link, when the storage location is known', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:cached/1');
    URL.revokeObjectURL = vi.fn();
    cache.getCachedPdf.mockResolvedValue(new Blob(['%PDF']));
    const storage = { bucket: 'course-materials' as const, path: 'c/notes.pdf' };

    render(<PdfReader source={source({ storage, signedUrl: 'https://expired.test/notes.pdf' })} />);

    await screen.findByText('/ 3');
    expect(screen.getByTestId('pdf-doc')).toHaveAttribute('data-file', 'blob:cached/1');
    expect(cache.getCachedPdf).toHaveBeenCalledWith(storage);
  });

  it('says so when the document cannot be downloaded', async () => {
    cache.getCachedPdf.mockRejectedValue(new Error('PDF download failed (404)'));
    render(<PdfReader source={source({ storage: { bucket: 'course-materials', path: 'c/gone.pdf' } })} />);
    expect(await screen.findByText(/couldn't load this document/i)).toBeInTheDocument();
  });

  it('shows a placeholder when there is no signed URL', async () => {
    render(<PdfReader source={source({ signedUrl: undefined })} />);
    expect(await screen.findByText(/No document available to preview/i)).toBeInTheDocument();
  });
  describe('search', () => {
    const searchBox = () => screen.getByRole('searchbox', { name: 'Search document' });

    it('finds matches across pages and jumps to the first one', async () => {
      render(<PdfReader source={source({ pageNumber: 1 })} />);
      await screen.findByText('/ 3');

      fireEvent.change(searchBox(), { target: { value: 'probing' } });

      expect(await screen.findByText('1 of 3')).toBeInTheDocument();
      // The jump to the first match's page follows the results showing.
      await waitFor(() => expect(pageInput().value).toBe('2'));
      expect(scrolledTo.at(-1)).toBe(2);
    });

    it('steps through matches with Enter and the arrows, wrapping at the ends', async () => {
      render(<PdfReader source={source({ pageNumber: 1 })} />);
      await screen.findByText('/ 3');
      fireEvent.change(searchBox(), { target: { value: 'probing' } });
      await screen.findByText('1 of 3');

      fireEvent.keyDown(searchBox(), { key: 'Enter' });
      expect(screen.getByText('2 of 3')).toBeInTheDocument();
      expect(pageInput().value).toBe('3');

      fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
      fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
      expect(pageInput().value).toBe('2');

      fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
      expect(screen.getByText('3 of 3')).toBeInTheDocument();
    });

    it('highlights matches on the pages', async () => {
      render(<PdfReader source={source({ pageNumber: 1 })} />);
      await screen.findByText('/ 3');
      fireEvent.change(searchBox(), { target: { value: 'probing' } });
      await screen.findByText('1 of 3');

      const marks = screen.getAllByTestId('text-layer').flatMap((layer) => [...layer.querySelectorAll('mark')]);
      expect(marks.map((mark) => mark.textContent)).toEqual(['probing', 'probing', 'probing']);
    });

    it('fills only the current match; the others are outlined', async () => {
      render(<PdfReader source={source({ pageNumber: 1 })} />);
      await screen.findByText('/ 3');
      fireEvent.change(searchBox(), { target: { value: 'probing' } });
      await screen.findByText('1 of 3');

      const activeMarks = () =>
        [...document.querySelectorAll<HTMLElement>('mark.pdf-search-hit--active')].map(
          (mark) => mark.closest<HTMLElement>('[data-page]')?.dataset.page,
        );
      expect(activeMarks()).toEqual(['2']);

      fireEvent.keyDown(searchBox(), { key: 'Enter' });
      fireEvent.keyDown(searchBox(), { key: 'Enter' });
      expect(screen.getByText('3 of 3')).toBeInTheDocument();
      expect(activeMarks()).toEqual(['3']);
      expect(document.querySelectorAll('mark.pdf-search-hit')).toHaveLength(3);
    });

    it('says when nothing matches and clears when the box is emptied', async () => {
      render(<PdfReader source={source({ pageNumber: 1 })} />);
      await screen.findByText('/ 3');

      fireEvent.change(searchBox(), { target: { value: 'quadratic' } });
      expect(await screen.findByText('No matches')).toBeInTheDocument();

      fireEvent.change(searchBox(), { target: { value: '' } });
      expect(screen.queryByText('No matches')).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('text-layer')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
    });
  });
});
