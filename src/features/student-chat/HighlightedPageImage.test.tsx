import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HighlightedPageImage } from './HighlightedPageImage';

const image = { url: 'https://img.test/p2.webp', width: 1400, height: 700 };

describe('HighlightedPageImage', () => {
  it('shows the page image at its own aspect ratio', () => {
    render(<HighlightedPageImage image={image} alt="Notes, page 2" />);
    const img = screen.getByRole('img', { name: 'Notes, page 2' });
    expect(img).toHaveAttribute('src', image.url);
    expect(img).toHaveAttribute('width', '1400');
    expect(img).toHaveAttribute('height', '700');
    expect(screen.queryByTestId('citation-highlight')).not.toBeInTheDocument();
  });

  it('draws the cited box over the image, padded slightly', () => {
    render(<HighlightedPageImage image={image} alt="Notes, page 2" highlightBoxes={[[0.1, 0.2, 0.6, 0.3]]} />);
    const highlight = screen.getByTestId('citation-highlight');
    expect(highlight).toHaveStyle({ left: '9.2%', top: '19.4%', width: '51.6%', height: '11.2%' });
    expect(screen.getByText('Cited passage highlighted')).toBeInTheDocument();
    // A highlighter fill with no border; multiply keeps the text underneath dark.
    expect(highlight.className).toContain('bg-yellow-300/50');
    expect(highlight.className).toContain('mix-blend-multiply');
    expect(highlight.className).not.toMatch(/\bborder|\bring-/);
  });

  it('keeps a box at the page edge inside the image', () => {
    render(<HighlightedPageImage image={image} alt="Notes, page 2" highlightBoxes={[[0, 0, 1, 1]]} />);
    expect(screen.getByTestId('citation-highlight')).toHaveStyle({ left: '0%', top: '0%', width: '100%', height: '100%' });
  });

  it('draws one outline per cited block and announces them once', () => {
    render(
      <HighlightedPageImage
        image={image}
        alt="Notes, page 2"
        highlightBoxes={[
          [0.1, 0.2, 0.6, 0.3],
          [0.1, 0.5, 0.9, 0.7],
        ]}
      />,
    );
    expect(screen.getAllByTestId('citation-highlight')).toHaveLength(2);
    expect(screen.getAllByText('Cited passage highlighted')).toHaveLength(1);
  });
});
