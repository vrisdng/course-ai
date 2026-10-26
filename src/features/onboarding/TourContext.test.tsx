import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TourHelpButton, TourProvider, useRegisterTour } from './TourContext';

function PageWithTour({ start }: { start: () => void }) {
  useRegisterTour(start);
  return null;
}

describe('TourHelpButton', () => {
  it('is hidden when the current page has no tour', () => {
    render(
      <TourProvider>
        <TourHelpButton />
      </TourProvider>,
    );

    expect(screen.queryByRole('button', { name: /tour/i })).not.toBeInTheDocument();
  });

  it('starts the registered tour when clicked', () => {
    const start = vi.fn();
    render(
      <TourProvider>
        <PageWithTour start={start} />
        <TourHelpButton />
      </TourProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show tour' }));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('disappears again when the page with the tour unmounts', () => {
    const { rerender } = render(
      <TourProvider>
        <PageWithTour start={vi.fn()} />
        <TourHelpButton />
      </TourProvider>,
    );
    expect(screen.getByRole('button', { name: 'Show tour' })).toBeInTheDocument();

    rerender(
      <TourProvider>
        <TourHelpButton />
      </TourProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Show tour' })).not.toBeInTheDocument();
  });

  it('renders nothing outside a provider', () => {
    render(<TourHelpButton />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
