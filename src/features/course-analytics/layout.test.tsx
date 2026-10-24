import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnalyticsRangePicker } from './AnalyticsRangePicker';
import { AskAnalyticsSheet } from './AskAnalyticsSheet';

describe('AnalyticsRangePicker', () => {
  it('switches presets and reveals the custom inputs', () => {
    const onPresetChange = vi.fn();
    const { rerender } = render(
      <AnalyticsRangePicker
        preset="30d" onPresetChange={onPresetChange}
        customStart="" customEnd="" onCustomStartChange={vi.fn()} onCustomEndChange={vi.fn()}
        error={null}
      />,
    );
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    expect(onPresetChange).toHaveBeenCalledWith('7d');

    const onCustomStartChange = vi.fn();
    rerender(
      <AnalyticsRangePicker
        preset="custom" onPresetChange={onPresetChange}
        customStart="2026-10-01T00:00" customEnd="2026-10-02T00:00"
        onCustomStartChange={onCustomStartChange} onCustomEndChange={vi.fn()}
        error="Start date and time must be earlier than or equal to the end date and time."
      />,
    );
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-09-01T00:00' } });
    expect(onCustomStartChange).toHaveBeenCalledWith('2026-09-01T00:00');
    expect(screen.getByRole('alert')).toHaveTextContent('Start date and time must be earlier');
  });
});

describe('AskAnalyticsSheet', () => {
  function chat(overrides: Record<string, unknown> = {}) {
    return {
      messages: [], input: '', setInput: vi.fn(), isLoading: false,
      handleSend: vi.fn(), stopGenerating: vi.fn(), clearChat: vi.fn(), ...overrides,
    } as unknown as Parameters<typeof AskAnalyticsSheet>[0]['chat'];
  }

  it('opens the analytics chat in a side panel', async () => {
    render(<AskAnalyticsSheet chat={chat()} disabledReason={null} rangeLabel="1 Oct 2026 – 24 Oct 2026" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ask about this data' });
    expect(within(dialog).getByText(/for 1 Oct 2026 – 24 Oct 2026/)).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('Ask about your course analytics...')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Clear chat' })).toBeDisabled();
  });

  it('explains why the chat is unavailable', async () => {
    render(<AskAnalyticsSheet chat={chat()} disabledReason="Choose an end date and time." rangeLabel={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Choose an end date and time.')).toBeInTheDocument();
  });
});
