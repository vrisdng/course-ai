import { describe, expect, it } from 'vitest';

import { stackedTable } from './responsiveTable';

describe('stackedTable', () => {
  it('hides column headers and stacks rows/cells only below the sm breakpoint', () => {
    expect(stackedTable.header).toBe('hidden sm:table-header-group');
    expect(stackedTable.row).toContain('block');
    expect(stackedTable.row).toContain('sm:table-row');
    expect(stackedTable.cell).toContain('block');
    expect(stackedTable.cell).toContain('sm:table-cell');
  });

  it('labels stacked cells from data-label and hides the label on desktop', () => {
    expect(stackedTable.cell).toContain('before:content-[attr(data-label)]');
    expect(stackedTable.cell).toContain('sm:before:hidden');
    expect(stackedTable.actionsCell).not.toContain('before:content');
    expect(stackedTable.plainCell).not.toContain('before:content');
    expect(stackedTable.plainCell).toContain('sm:table-cell');
  });

  it('wraps action buttons on phones and right-aligns them on desktop', () => {
    expect(stackedTable.actions).toContain('flex-wrap');
    expect(stackedTable.actions).toContain('sm:justify-end');
  });
});
