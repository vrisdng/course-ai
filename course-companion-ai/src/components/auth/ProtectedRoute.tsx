import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'student' | 'lecturer' | 'admin' | Array<'student' | 'lecturer' | 'admin'>;
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, profile, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  const allowedRoles = requiredRole
    ? Array.isArray(requiredRole)
      ? requiredRole
      : [requiredRole]
    : null;

  if (allowedRoles && (!profile?.role || !allowedRoles.includes(profile.role))) {
    // Redirect to appropriate dashboard based on role
    if (profile?.role === 'admin') {
      return <Navigate to="/admin-dashboard" replace />;
    }
    if (profile?.role === 'lecturer') {
      return <Navigate to="/lecturer" replace />;
    }
    return <Navigate to="/chat" replace />;
  }

  return <>{children}</>;
}
