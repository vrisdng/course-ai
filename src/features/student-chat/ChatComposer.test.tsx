import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

const props = () => ({ input: '', isLoading: false, onInputChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn() });
describe('ChatComposer', () => {
  it('renders context hints, propagates input, and sends on unshifted Enter', () => {
    const value = props();
    render(<ChatComposer {...value} input="Question" documentSelector={<button>Documents</button>} documentHint="Using notes" />);
    expect(screen.getByText('Documents')).toBeInTheDocument(); expect(screen.getByText('Using notes')).toBeInTheDocument();
    const textbox = screen.getByRole('textbox');
    fireEvent.change(textbox, { target: { value: 'Changed' } });
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: false });
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true });
    expect(value.onInputChange).toHaveBeenCalledWith('Changed'); expect(value.onSend).toHaveBeenCalledOnce();
  });
  it('disables send for blank input and calls send for nonblank input', () => {
    const value = props(); const { rerender } = render(<ChatComposer {...value} input="  " />);
    expect(screen.getByRole('button')).toBeDisabled();
    rerender(<ChatComposer {...value} input="ask" />);
    fireEvent.click(screen.getByRole('button')); expect(value.onSend).toHaveBeenCalled();
  });
  it('shows an enabled stop control while generating and calls onStop', () => {
    const value = props(); render(<ChatComposer {...value} isLoading input="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' })); expect(value.onStop).toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
  it('shows the selected model and respects global disabled state', () => {
    const value = props(); const onModelChange = vi.fn();
    render(<ChatComposer {...value} input="ask" selectedModel="smart" onModelChange={onModelChange} />);
    expect(screen.getByRole('button', { name: /GPT-5.6 Terra/i })).toBeInTheDocument();
    expect(screen.getByText(/CEEChat uses RAG/)).toBeInTheDocument();
  });
  it('only offers the models the course allows', async () => {
    const value = props();
    render(<ChatComposer {...value} input="ask" selectedModel="smart" onModelChange={vi.fn()} modelOptions={['smart', 'pro']} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /GPT-5.6 Terra/i }), { key: 'Enter' });
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Terra'),
      expect.stringContaining('Sol'),
    ]);
  });
});
