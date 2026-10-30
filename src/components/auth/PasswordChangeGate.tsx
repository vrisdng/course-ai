import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function PasswordChangeGate({ children }: { children: ReactNode }) {
  const { user, profile, isLoading } = useAuth();
  const location = useLocation();
  const needsName = user?.app_metadata?.must_change_password === false && profile?.role === 'student' && !profile.full_name?.trim();
  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" aria-label="Loading account" /></div>;
  if ((user?.app_metadata?.must_change_password === true || needsName) && location.pathname !== '/reset-password') {
    const params = new URLSearchParams(location.search);
    if (params.has('invite')) {
      params.delete('invite');
      params.delete('email');
    }
    const search = params.toString();
    const from = location.pathname + (search ? `?${search}` : '') + location.hash;
    return <Navigate to="/reset-password" state={{ from }} replace />;
  }
  return <>{children}</>;
}
