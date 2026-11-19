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
    expect(screen.getByText(/CEEGPT uses RAG/)).toBeInTheDocument();
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
  describe('images', () => {
    const image = { id: 'img-1', file: new File(['x'], 'working.png', { type: 'image/png' }), previewUrl: 'blob:working' };
    const imageProps = () => ({ ...props(), images: [] as typeof image[], onAddImages: vi.fn(), onRemoveImage: vi.fn() });

    it('offers attaching only where the page supports it', () => {
      const { rerender } = render(<ChatComposer {...props()} input="ask" />);
      expect(screen.queryByRole('button', { name: 'Attach images' })).not.toBeInTheDocument();
      rerender(<ChatComposer {...imageProps()} input="ask" />);
      expect(screen.getByRole('button', { name: 'Attach images' })).toBeEnabled();
    });

    it('adds picked and pasted images', () => {
      const value = imageProps();
      render(<ChatComposer {...value} />);
      const picked = new File(['p'], 'photo.jpg', { type: 'image/jpeg' });
      fireEvent.change(screen.getByLabelText('Image files'), { target: { files: [picked] } });
      expect(value.onAddImages).toHaveBeenCalledWith([picked]);

      const pasted = new File(['s'], 'image.png', { type: 'image/png' });
      fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [pasted], getData: () => '' } });
      expect(value.onAddImages).toHaveBeenLastCalledWith([pasted]);
    });

    it('ignores pasted text', () => {
      const value = imageProps();
      render(<ChatComposer {...value} />);
      fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [], getData: () => 'text' } });
      expect(value.onAddImages).not.toHaveBeenCalled();
    });

    it('previews attached images and removes them', () => {
      const value = imageProps();
      render(<ChatComposer {...value} images={[image]} />);
      expect(screen.getByRole('img', { name: 'working.png' })).toHaveAttribute('src', 'blob:working');
      fireEvent.click(screen.getByRole('button', { name: 'Remove working.png' }));
      expect(value.onRemoveImage).toHaveBeenCalledWith('img-1');
    });

    it('sends an image with no text', () => {
      const value = imageProps();
      render(<ChatComposer {...value} input="" images={[image]} />);
      const send = screen.getByRole('button', { name: 'Send' });
      expect(send).toBeEnabled();
      fireEvent.click(send);
      expect(value.onSend).toHaveBeenCalled();
    });

    it('stops offering more once the limit is reached', () => {
      const four = [0, 1, 2, 3].map((i) => ({ ...image, id: `img-${i}` }));
      render(<ChatComposer {...imageProps()} images={four} />);
      expect(screen.getByRole('button', { name: 'Attach images' })).toBeDisabled();
    });
  });
});
