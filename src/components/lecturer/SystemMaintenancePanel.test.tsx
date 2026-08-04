import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SystemMaintenancePanel } from './SystemMaintenancePanel';

describe('SystemMaintenancePanel', () => {
  it('is hidden from non-admin users', () => {
    const { container } = render(
      <SystemMaintenancePanel isAdmin={false} onRefresh={vi.fn()} onRecoverJobs={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('runs dashboard refresh and job recovery actions', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onRecoverJobs = vi.fn().mockResolvedValue({ reaped: 2, triggeredWorkers: 3 });

    render(
      <SystemMaintenancePanel isAdmin onRefresh={onRefresh} onRecoverJobs={onRecoverJobs} />,
    );

    expect(screen.getAllByText('Do this when:')).toHaveLength(3);
    expect(screen.getByText(/courses, terms, or enrollment codes look outdated/)).toBeInTheDocument();
    expect(screen.getByText(/a document stays in Queued or Processing/)).toBeInTheDocument();
    expect(screen.getByText(/the page looks outdated after a deployment/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard data' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await screen.findByText('Dashboard data refreshed.');

    fireEvent.click(screen.getByRole('button', { name: 'Recover processing jobs' }));
    await waitFor(() => expect(onRecoverJobs).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Recovered 2 stale jobs and started 3 workers.')).toBeInTheDocument();
  });

  it('reports action failures without crashing the panel', async () => {
    render(
      <SystemMaintenancePanel
        isAdmin
        onRefresh={vi.fn()}
        onRecoverJobs={vi.fn().mockRejectedValue(new Error('Worker unavailable'))}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recover processing jobs' }));

    expect(await screen.findByText('Worker unavailable')).toBeInTheDocument();
  });
});
