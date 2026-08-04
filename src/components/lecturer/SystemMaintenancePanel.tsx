import { useState } from 'react';
import { HardDriveDownload, RefreshCw, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface JobRecoveryResult {
  reaped: number;
  triggeredWorkers: number;
}

interface SystemMaintenancePanelProps {
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
  onRecoverJobs: () => Promise<JobRecoveryResult>;
}

type ActionName = 'refresh' | 'recover' | 'cache';

export function SystemMaintenancePanel({
  isAdmin,
  onRefresh,
  onRecoverJobs,
}: SystemMaintenancePanelProps) {
  const [activeAction, setActiveAction] = useState<ActionName | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  if (!isAdmin) return null;

  const runAction = async (action: ActionName, operation: () => Promise<string>) => {
    setActiveAction(action);
    setStatus(null);
    setIsError(false);
    try {
      setStatus(await operation());
    } catch (error) {
      setIsError(true);
      setStatus(error instanceof Error ? error.message : 'Maintenance action failed');
    } finally {
      setActiveAction(null);
    }
  };

  const clearBrowserCache = async (): Promise<string> => {
    if (!('caches' in window)) return 'This browser does not expose an app cache to clear.';
    const keys = await window.caches.keys();
    await Promise.all(keys.map((key) => window.caches.delete(key)));
    return `Cleared ${keys.length} browser cache${keys.length === 1 ? '' : 's'}. Reload the page to fetch fresh assets.`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">System maintenance</CardTitle>
        <CardDescription>
          Safe recovery tools for common stale-data and document-processing problems. These actions do not delete course data.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <MaintenanceAction
          icon={<RefreshCw />}
          title="Refresh dashboard data"
          description="Fetch the latest courses, terms, and enrollment codes from the database."
          guidance="Do this when courses, terms, or enrollment codes look outdated or do not reflect a recent change."
          busy={activeAction === 'refresh'}
          disabled={activeAction !== null}
          onClick={() => void runAction('refresh', async () => {
            await onRefresh();
            return 'Dashboard data refreshed.';
          })}
        />
        <MaintenanceAction
          icon={<RotateCcw />}
          title="Recover processing jobs"
          description="Release stale document jobs and start up to five pending workers."
          guidance="Do this when a document stays in Queued or Processing for more than five minutes."
          busy={activeAction === 'recover'}
          disabled={activeAction !== null}
          onClick={() => void runAction('recover', async () => {
            const result = await onRecoverJobs();
            return `Recovered ${result.reaped} stale jobs and started ${result.triggeredWorkers} workers.`;
          })}
        />
        <MaintenanceAction
          icon={<HardDriveDownload />}
          title="Clear browser cache"
          description="Remove cached app assets without deleting your login session or course data."
          guidance="Do this when the page looks outdated after a deployment or UI changes are not appearing."
          busy={activeAction === 'cache'}
          disabled={activeAction !== null}
          onClick={() => void runAction('cache', clearBrowserCache)}
        />
        {status && (
          <p role={isError ? 'alert' : 'status'} className={`text-sm md:col-span-3 ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {status}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface MaintenanceActionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  guidance: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

function MaintenanceAction({ icon, title, description, guidance, busy, disabled, onClick }: MaintenanceActionProps) {
  return (
    <div className="flex flex-col rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2 font-medium">{icon}{title}</div>
      <p className="mb-4 flex-1 text-sm text-muted-foreground">{description}</p>
      <p className="mb-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Do this when:</span>{' '}
        {guidance.replace(/^Do this when /, '')}
      </p>
      <Button variant="outline" disabled={disabled} onClick={onClick}>
        {busy ? 'Working…' : title}
      </Button>
    </div>
  );
}
