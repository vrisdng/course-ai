import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

import type { HighlightBox, PageImage } from './documentViewer';

// Breathing room around the matched lines, in page fractions.
const PAD_X = 0.008;
const PAD_Y = 0.006;

interface HighlightedPageImageProps {
  image: PageImage;
  alt: string;
  highlightBox?: HighlightBox | null;
  className?: string;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 10_000) / 100}%`;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// A rendered page with the cited passage boxed. The box is positioned in
// percentages of the page, so it stays aligned at any display size. The ref
// points at the box so callers can scroll it into view.
export const HighlightedPageImage = forwardRef<HTMLDivElement, HighlightedPageImageProps>(
  function HighlightedPageImage({ image, alt, highlightBox, className }, highlightRef) {
    const padded = highlightBox
      ? [
          clamp(highlightBox[0] - PAD_X),
          clamp(highlightBox[1] - PAD_Y),
          clamp(highlightBox[2] + PAD_X),
          clamp(highlightBox[3] + PAD_Y),
        ]
      : null;

    return (
      <div className={cn('relative', className)}>
        {/* width/height let the browser reserve the page's shape before it loads */}
        <img src={image.url} alt={alt} width={image.width} height={image.height} className="block h-auto w-full" />
        {padded ? (
          <>
            <div
              ref={highlightRef}
              data-testid="citation-highlight"
              aria-hidden="true"
              className="pointer-events-none absolute rounded-sm border-2 border-yellow-400"
              style={{
                left: percent(padded[0]),
                top: percent(padded[1]),
                width: percent(padded[2] - padded[0]),
                height: percent(padded[3] - padded[1]),
              }}
            />
            <span className="sr-only">Cited passage highlighted</span>
          </>
        ) : null}
      </div>
    );
  },
);
