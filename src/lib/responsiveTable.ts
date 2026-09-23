/**
 * Class names that turn a shadcn `<Table>` into a stacked card list below the `sm` breakpoint
 * while leaving the normal table layout untouched on wider screens.
 *
 * Usage: put `header` on `<TableHeader>`, `row` on each body `<TableRow>`, and `cell` on each
 * `<TableCell>` together with a `data-label` attribute that names the column. The label is shown
 * before the value only on phones, where the column headers are hidden.
 */
export const stackedTable = {
  header: 'hidden sm:table-header-group',
  row: 'block py-3 sm:table-row sm:py-0',
  cell: [
    'block px-0 py-1 sm:table-cell sm:p-4',
    'before:mr-2 before:font-sans before:text-xs before:uppercase before:tracking-wide before:text-muted-foreground',
    'before:content-[attr(data-label)] sm:before:hidden',
  ].join(' '),
  /** Stacked cell with no label, for values that read as the card title (a name, a filename). */
  plainCell: 'block px-0 py-1 sm:table-cell sm:p-4',
  /** Cell holding row actions: no label, buttons wrap on phones and right-align on desktop. */
  actionsCell: 'block px-0 pt-2 sm:table-cell sm:p-4',
  actions: 'flex flex-wrap gap-2 sm:justify-end',
} as const;
