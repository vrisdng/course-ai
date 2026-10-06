import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) } },
}));

import { StoredVideoPlayer } from './StoredVideoPlayer';

describe('StoredVideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/video?token=new' }, error: null });
  });

  it('signs a private video and seeks to the cited time after metadata loads', async () => {
    render(<StoredVideoPlayer filePath="course/video.mp4" startMs={42_000} />);
    await waitFor(() => expect(mocks.createSignedUrl).toHaveBeenCalledWith('course/video.mp4', 3600));
    const player = screen.getByLabelText('Video playback') as HTMLVideoElement;
    await waitFor(() => expect(player).toHaveAttribute('src', 'https://storage.test/video?token=new'));
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(42);
  });

  it('seeks when a transcript timestamp is selected', async () => {
    const { rerender } = render(<StoredVideoPlayer filePath="course/video.mp4" startMs={0} seekMs={0} />);
    const player = screen.getByLabelText('Video playback') as HTMLVideoElement;
    await waitFor(() => expect(player).toHaveAttribute('src', 'https://storage.test/video?token=new'));
    fireEvent.loadedMetadata(player);
    rerender(<StoredVideoPlayer filePath="course/video.mp4" startMs={0} seekMs={75_000} />);
    expect(player.currentTime).toBe(75);
  });

  it('renews an expired URL and restores playback position', async () => {
    mocks.createSignedUrl
      .mockResolvedValueOnce({ data: { signedUrl: 'https://storage.test/old' }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://storage.test/new' }, error: null });
    render(<StoredVideoPlayer filePath="course/video.mp4" startMs={0} showOpenLink />);
    const player = screen.getByLabelText('Video playback') as HTMLVideoElement;
    await waitFor(() => expect(player).toHaveAttribute('src', 'https://storage.test/old'));
    fireEvent.loadedMetadata(player);
    player.currentTime = 321;
    await act(async () => { fireEvent.error(player); });
    await waitFor(() => expect(player).toHaveAttribute('src', 'https://storage.test/new'));
    expect(screen.getByRole('link', { name: 'Open video' })).toHaveAttribute('href', 'https://storage.test/new');
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(321);
  });

  it('shows a recoverable error when a URL cannot be signed', async () => {
    mocks.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Access denied' } });
    render(<StoredVideoPlayer filePath="course/video.mp4" startMs={0} />);
    expect(await screen.findByText(/Access denied/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry video' })); });
    await waitFor(() => expect(mocks.createSignedUrl).toHaveBeenCalledTimes(2));
  });
});
