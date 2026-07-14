import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsChatMessageList } from './AnalyticsChatMessageList';

describe('AnalyticsChatMessageList', () => {
  it('offers actionable prompts in the empty state', () => {
    const onSuggestionClick = vi.fn(); render(<AnalyticsChatMessageList messages={[]} onSuggestionClick={onSuggestionClick} />);
    expect(screen.getByText('Course Analytics')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Which documents are most referenced?' }));
    expect(onSuggestionClick).toHaveBeenCalledWith('Which documents are most referenced?');
  });
  it('renders markdown answers and an in-progress assistant state', () => {
    render(<AnalyticsChatMessageList onSuggestionClick={vi.fn()} messages={[
      { id: 'u1', role: 'user', content: 'Show usage' },
      { id: 'a1', role: 'assistant', content: '## Result\n- 42 students' },
      { id: 'a2', role: 'assistant', content: '' },
    ]} />);
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByText('42 students')).toBeInTheDocument();
    expect(screen.getByText('Analyzing data...')).toBeInTheDocument();
  });
});
