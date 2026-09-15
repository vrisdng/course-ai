import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
import { useTranscriptWindow } from './useTranscriptWindow';

function eagerChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => void) => resolve({ data, error: null });
  return chain;
}

function deferredChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) chain[method] = vi.fn(() => chain);
  let resolveWith: ((value: unknown) => void) | null = null;
  chain.then = vi.fn((resolve: (value: unknown) => void) => {
    resolveWith = resolve;
  });
  return { chain, resolveWith: (value: unknown) => resolveWith?.({ data: value, error: null }) };
}

const transcriptSegments = [
  { start_ms: 35_000, end_ms: 42_000, text: 'Relevant explanation.' },
  { start_ms: 42_000, end_ms: 48_000, text: 'More context.' },
];

describe('useTranscriptWindow', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.from.mockImplementation(() => eagerChain([]));
  });

  it('does not fetch when there is no material id', () => {
    const { result } = renderHook(() => useTranscriptWindow(null, 40_000, 45_000));
    expect(result.current.segments).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('queries a transcript window bounded around the cited segment', async () => {
    const chain = eagerChain(transcriptSegments);
    mocks.from.mockReturnValue(chain);
    const { result } = renderHook(() => useTranscriptWindow('m1', 40_000, 45_000));
    await waitFor(() => expect(result.current.segments).toHaveLength(2));
    expect(chain.eq).toHaveBeenCalledWith('material_id', 'm1');
    expect(chain.gte).toHaveBeenCalledWith('start_ms', 10_000);
    expect(chain.lte).toHaveBeenCalledWith('start_ms', 75_000);
    expect(result.current.isLoading).toBe(false);
  });

  it('uses the start time when no end time is provided', async () => {
    const chain = eagerChain(transcriptSegments);
    mocks.from.mockReturnValue(chain);
    renderHook(() => useTranscriptWindow('m1', 40_000, undefined));
    await waitFor(() => expect(chain.lte).toHaveBeenCalled());
    expect(chain.lte).toHaveBeenCalledWith('start_ms', 70_000);
  });

  it('clears segments and reports failure without throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'order']) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => void) => resolve({ data: null, error: { message: 'offline' } });
    mocks.from.mockReturnValue(chain);
    const { result } = renderHook(() => useTranscriptWindow('m1', 40_000, 45_000));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.segments).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('ignores results from a superseded request', async () => {
    const first = deferredChain();
    const second = deferredChain();
    const queue = [first, second];
    mocks.from.mockImplementation(() => queue.shift()!.chain);

    const { rerender, result } = renderHook(
      ({ materialId }: { materialId: string }) => useTranscriptWindow(materialId, 40_000, 45_000),
      { initialProps: { materialId: 'm1' } },
    );

    expect(first.chain.then).toHaveBeenCalled();
    rerender({ materialId: 'm2' });
    expect(second.chain.then).toHaveBeenCalled();

    first.resolveWith([{ start_ms: 1, end_ms: 2, text: 'stale' }]);
    second.resolveWith([{ start_ms: 3, end_ms: 4, text: 'fresh' }]);

    await waitFor(() =>
      expect(result.current.segments).toEqual([{ start_ms: 3, end_ms: 4, text: 'fresh' }]),
    );

    // A late resolution of the cancelled request must not mutate state.
    first.resolveWith([{ start_ms: 1, end_ms: 2, text: 'stale-again' }]);
    await waitFor(() =>
      expect(result.current.segments).toEqual([{ start_ms: 3, end_ms: 4, text: 'fresh' }]),
    );
  });
});
