import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

export default function Landing() {
  const { isAdmin } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">EduChat</h1>
          <p className="text-muted-foreground">
            Ask questions about your course materials and get grounded answers with citations.
          </p>
        </div>

        <div className="flex w-full max-w-md flex-col gap-4">
        <Link to="/chat" className="w-full">
          <Button size="lg" className="w-full">
            Go to chat
          </Button>
        </Link>
        {isAdmin && (
          <Link to="/admin-dashboard" className="w-full">
            <Button size="lg" variant="outline" className="w-full">
              Admin Dashboard
            </Button>
          </Link>
        )}
        </div>
      </div>
    </div>
  );
}
