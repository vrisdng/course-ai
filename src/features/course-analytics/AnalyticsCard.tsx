import { useId, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

interface AnalyticsCardProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function AnalyticsCard({ title, description, action, className, children }: AnalyticsCardProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('min-w-0 rounded-xl border border-border bg-card p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function CardLoading({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-6">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={label} />
    </div>
  );
}

export function CardError({ message }: { message: string }) {
  return <p role="alert" className="text-sm text-destructive">{message}</p>;
}

export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
}
