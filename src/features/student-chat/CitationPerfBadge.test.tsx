import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { beginCitationOpen, clearCitationPerf, finishCitationOpen, markCitationStep } from './citationPerf';
import { CitationPerfBadge } from './CitationPerfBadge';

describe('CitationPerfBadge', () => {
  beforeEach(() => {
    clearCitationPerf();
    window.history.replaceState({}, '', '/?perf=citations');
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    beginCitationOpen('video');
    clock = 30;
    markCitationStep('panel_state');
    clock = 80;
    markCitationStep('transcript_painted');
    finishCitationOpen('success');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('renders nothing when the debug flag is absent', () => {
    window.history.replaceState({}, '', '/');
    const { container } = render(<CitationPerfBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the last sample when the debug flag is enabled', () => {
    render(<CitationPerfBadge />);

    expect(screen.getByText('80ms')).toBeInTheDocument();
    expect(screen.getByText('30ms')).toBeInTheDocument();
    expect(screen.getByText(/0 media/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download citation perf JSON' })).toBeInTheDocument();
  });
});
