import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/components/layout/MainLayout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

import Survey from './Survey';

const renderSurvey = () => render(<MemoryRouter><Survey /></MemoryRouter>);

describe('Survey page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
  });

  it('shows the purpose, optionality note, and all twenty questions', () => {
    renderSurvey();

    expect(screen.getByRole('heading', { name: 'CEEGPT feedback survey' })).toBeInTheDocument();
    expect(screen.getByText(
      'Your responses will help improve CEEGPT and shape the experience of future students in the project.',
    )).toBeInTheDocument();
    expect(screen.getByText(/All questions are optional/)).toBeInTheDocument();

    for (const question of [
      '1. How easy was it to get your first useful answer?',
      '7. How often did answers correctly reflect the course materials?',
      '13. Did you hit anything broken or that behaved unexpectedly?',
      '20. Anything else we should know?',
    ]) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(20);
  });

  it('submits only answered questions and confirms the saved response', async () => {
    renderSurvey();

    fireEvent.click(screen.getByRole('radio', {
      name: '1. How easy was it to get your first useful answer? — 5',
    }));
    fireEvent.change(screen.getByRole('textbox', {
      name: '5. What was the most frustrating moment?',
    }), { target: { value: 'The source panel was hard to find.' } });
    fireEvent.click(screen.getByRole('radio', {
      name: '18. Rate the importance of each of the following. — Mobile use — 5',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('submit-survey', {
      body: {
        answers: [
          { question: '1. How easy was it to get your first useful answer?', answer: '5' },
          { question: '5. What was the most frustrating moment?', answer: 'The source panel was hard to find.' },
          { question: '18. Rate the importance of each of the following. — Mobile use', answer: '5' },
        ],
      },
    }));

    expect(await screen.findByText('Thank you! Your response has been saved.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to chat' })).toHaveAttribute('href', '/chat');
  });

  it('refuses an entirely blank submission', () => {
    renderSurvey();

    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('Please answer at least one question before submitting.');
  });

  it('surfaces a submission error and keeps the form open', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'network down' } });
    renderSurvey();

    fireEvent.click(screen.getByRole('radio', { name: '13. Did you hit anything broken or that behaved unexpectedly? — No' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('network down'));
    expect(screen.queryByText('Thank you! Your response has been saved.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit feedback' })).toBeEnabled();
  });
});
