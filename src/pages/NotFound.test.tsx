import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import NotFound from './NotFound';

describe('NotFound', () => {
  it('reports the missing path and links back home', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MemoryRouter initialEntries={['/missing-page']}><NotFound /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Home' })).toHaveAttribute('href', '/');
    expect(error).toHaveBeenCalledWith('404 Error: User attempted to access non-existent route:', '/missing-page');
    error.mockRestore();
  });
});
