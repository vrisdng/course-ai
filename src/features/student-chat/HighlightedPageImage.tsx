import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

import type { HighlightBox, PageImage } from './documentViewer';

// Breathing room around the matched lines, in page fractions.
const PAD_X = 0.008;
const PAD_Y = 0.006;

interface HighlightedPageImageProps {
  image: PageImage;
  alt: string;
  highlightBoxes?: HighlightBox[];
  className?: string;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 10_000) / 100}%`;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function padded(box: HighlightBox): HighlightBox {
  return [clamp(box[0] - PAD_X), clamp(box[1] - PAD_Y), clamp(box[2] + PAD_X), clamp(box[3] + PAD_Y)];
}

// A rendered page with each cited block outlined. Outlines are positioned in
// percentages of the page, so they stay aligned at any display size. The ref
// points at the first outline so callers can scroll it into view.
export const HighlightedPageImage = forwardRef<HTMLDivElement, HighlightedPageImageProps>(
  function HighlightedPageImage({ image, alt, highlightBoxes = [], className }, highlightRef) {
    return (
      <div className={cn('relative', className)}>
        {/* width/height let the browser reserve the page's shape before it loads */}
        <img src={image.url} alt={alt} width={image.width} height={image.height} className="block h-auto w-full" />
        {highlightBoxes.map((box, index) => {
          const [x0, y0, x1, y1] = padded(box);
          return (
            <div
              key={`${index}-${box.join(',')}`}
              ref={index === 0 ? highlightRef : undefined}
              data-testid="citation-highlight"
              aria-hidden="true"
              className="pointer-events-none absolute rounded-sm border-2 border-yellow-400"
              style={{ left: percent(x0), top: percent(y0), width: percent(x1 - x0), height: percent(y1 - y0) }}
            />
          );
        })}
        {highlightBoxes.length > 0 ? <span className="sr-only">Cited passage highlighted</span> : null}
      </div>
    );
  },
);
