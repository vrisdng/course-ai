import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Footer } from './Footer';

describe('Footer', () => {
  it('credits both developers while preserving the copyright', () => {
    render(<Footer />);
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('Developed by Duong Ngoc Mai and Kavishwer Sathiamorthy');
    expect(footer).toHaveTextContent(`© ${new Date().getFullYear()} CEEGPT. All rights reserved.`);
  });
});
