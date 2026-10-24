import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnalyticsRangePicker } from './AnalyticsRangePicker';
import { AnalyticsSummary } from './AnalyticsSummary';
import { AskAnalyticsSheet } from './AskAnalyticsSheet';
import { MaterialsExplorer } from './MaterialsExplorer';
import type { CitedMaterialsState } from './useCitedMaterials';
import type { KeywordSearchState } from './useKeywordSearch';

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

describe('AnalyticsSummary', () => {
  it('shows questions, active students, answered share and cited materials', () => {
    render(
      <AnalyticsSummary
        isLoading={false}
        stats={{ enrolledStudents: 20, activeStudents: 12, documents: 8, totalQuestions: 42 }}
        buckets={[
          { category: 'calculation', questionCount: 30, labeledCount: 30, studyQuestionCount: 28, answeredFromMaterialsCount: 24 },
          { category: 'other', questionCount: 12, labeledCount: 10, studyQuestionCount: 0, answeredFromMaterialsCount: 0 },
        ]}
        citedMaterialCount={5}
      />,
    );
    const tile = (name: string) => screen.getByRole('group', { name });
    expect(within(tile('Questions')).getByText('42')).toBeInTheDocument();
    expect(within(tile('Active students')).getByText('12')).toBeInTheDocument();
    expect(within(tile('Active students')).getByText('of 20 enrolled')).toBeInTheDocument();
    expect(within(tile('Answered from materials')).getByText('60%')).toBeInTheDocument();
    expect(within(tile('Answered from materials')).getByText('24 of 40 labelled')).toBeInTheDocument();
    expect(within(tile('Materials cited')).getByText('5')).toBeInTheDocument();
    expect(within(tile('Materials cited')).getByText('of 8 materials')).toBeInTheDocument();
  });

  it('shows dashes before data arrives and when nothing is labelled', () => {
    render(<AnalyticsSummary isLoading={false} stats={null} buckets={[]} citedMaterialCount={null} />);
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});

function materialsState(): CitedMaterialsState {
  return {
    materials: [{ materialId: 'm1', fileName: 'Recursion.pdf', fileType: 'pdf', questionCount: 3, studentCount: 2, citationCount: 4, lastCitedAt: null }],
    isLoading: false, error: null, expanded: {}, toggleMaterial: vi.fn(),
  };
}

function keywordState(overrides: Partial<KeywordSearchState> = {}): KeywordSearchState {
  return {
    keyword: '', setKeyword: vi.fn(), search: vi.fn().mockResolvedValue(undefined), clear: vi.fn(),
    searchedKeyword: null, places: [], isSearching: false, searchError: null,
    selectedKeys: new Set(), togglePlace: vi.fn(), result: null, isCounting: false, countError: null,
    ...overrides,
  };
}

describe('MaterialsExplorer', () => {
  it('lists cited materials until a keyword is searched', () => {
    const keyword = keywordState({ keyword: 'stack' });
    render(<MaterialsExplorer materials={materialsState()} keyword={keyword} />);
    expect(screen.getByRole('heading', { name: 'What students asked about' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recursion\.pdf/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search a topic in your materials'), { target: { value: 'queue' } });
    expect(keyword.setKeyword).toHaveBeenCalledWith('queue');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(keyword.search).toHaveBeenCalled();
  });

  it('shows keyword results with a way back to all materials', () => {
    const keyword = keywordState({ keyword: 'banana', searchedKeyword: 'banana' });
    render(<MaterialsExplorer materials={materialsState()} keyword={keyword} />);
    expect(screen.queryByRole('button', { name: /Recursion\.pdf/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing in this course's materials matched "banana"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to all materials' }));
    expect(keyword.clear).toHaveBeenCalled();
  });

  it('shows a search error in place of results', () => {
    render(<MaterialsExplorer materials={materialsState()} keyword={keywordState({ keyword: 'x', searchError: 'keyword is required' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('keyword is required');
    expect(screen.getByRole('button', { name: 'Back to all materials' })).toBeInTheDocument();
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
