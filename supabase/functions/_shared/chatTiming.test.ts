import { describe, expect, it } from 'vitest';
import { ChatTiming } from './chatTiming';

describe('ChatTiming', () => {
  it('records independent overlapping spans and elapsed marks without content', async () => {
    let now = 10;
    const timing = new ChatTiming(() => now);
    now = 15;
    timing.mark('setup');
    await timing.measure('search', async () => {
      now = 20;
      await timing.measure('source_prep', async () => { now = 23; });
      now = 30;
    });
    expect(timing.snapshot()).toEqual({ setup: [5], source_prep: [3], search: [15] });
  });
  it('records a failed span', async () => {
    let now = 0;
    const timing = new ChatTiming(() => now);
    await expect(timing.measure('search', async () => { now = 7; throw new Error('failed'); })).rejects.toThrow();
    expect(timing.snapshot()).toEqual({ search: [7] });
  });
});
