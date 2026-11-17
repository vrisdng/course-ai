import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnalyticsRangePicker } from './AnalyticsRangePicker';
import { AskAnalyticsSheet } from './AskAnalyticsSheet';

describe('AnalyticsRangePicker', () => {
  const base = {
    customStart: '', customEnd: '', onCustomStartChange: vi.fn(), onCustomEndChange: vi.fn(), error: null, rangeLabel: '1 Oct 2026 – 24 Oct 2026',
  };

  it('shows the range on one button and picks a preset from its menu', async () => {
    const onPresetChange = vi.fn();
    render(<AnalyticsRangePicker {...base} preset="30d" onPresetChange={onPresetChange} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Last 30 days/ }));
    const menu = await screen.findByRole('radiogroup', { name: 'Date range' });
    expect(within(menu).getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('radio', { name: 'Last 7 days' }));
    expect(onPresetChange).toHaveBeenCalledWith('7d');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('edits a custom range inside the menu', async () => {
    const onPresetChange = vi.fn();
    const onCustomStartChange = vi.fn();
    const { rerender } = render(<AnalyticsRangePicker {...base} preset="30d" onPresetChange={onPresetChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Last 30 days/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Custom range' }));
    expect(onPresetChange).toHaveBeenCalledWith('custom');

    rerender(
      <AnalyticsRangePicker
        {...base} preset="custom" onPresetChange={onPresetChange}
        customStart="2026-10-01T00:00" customEnd="2026-10-02T00:00" onCustomStartChange={onCustomStartChange}
        error="Start date and time must be earlier than or equal to the end date and time."
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Date range' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-09-01T00:00' } });
    expect(onCustomStartChange).toHaveBeenCalledWith('2026-09-01T00:00');
    expect(screen.getByRole('alert')).toHaveTextContent('Start date and time must be earlier');
  });

  it('labels the button with the custom dates, or asks for them', () => {
    const { rerender } = render(<AnalyticsRangePicker {...base} preset="custom" onPresetChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /1 Oct 2026 – 24 Oct 2026/ })).toBeInTheDocument();
    rerender(<AnalyticsRangePicker {...base} preset="custom" rangeLabel={null} onPresetChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Custom range/ })).toBeInTheDocument();
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
