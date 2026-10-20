import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function PasswordChangeGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" aria-label="Loading account" /></div>;
  if (user?.app_metadata?.must_change_password === true && location.pathname !== '/reset-password') {
    const pathname = location.pathname === '/auth' && new URLSearchParams(location.search).has('invite') ? '/' : location.pathname;
    const from = pathname + location.search + location.hash;
    return <Navigate to="/reset-password" state={{ from }} replace />;
  }
  return <>{children}</>;
}
