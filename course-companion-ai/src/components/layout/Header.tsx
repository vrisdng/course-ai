import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { LogOut, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Header() {
  const { user, profile, signOut, isAdmin } = useAuth();

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="EduChat logo" className="h-9 w-9 object-contain" />
          <span className="text-xl font-semibold text-foreground">EduChat</span>
        </Link>

        <nav className="flex items-center gap-4">
          {user ? (
            <>
              {isAdmin && (
                <Link to="/admin-dashboard">
                  <Button variant="ghost" size="sm">
                    Admin
                  </Button>
                </Link>
              )}
              {isAdmin && (
                <Link to="/admin-analytics">
                  <Button variant="ghost" size="sm">
                    Analytics
                  </Button>
                </Link>
              )}

              <Link to="/chat">
                <Button variant="ghost" size="sm">
                  Chat
                </Button>
              </Link>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={profile?.avatar_url || ''} alt={profile?.full_name || ''} />
                      <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                        {getInitials(profile?.full_name || null, user.email || '')}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="flex items-center gap-2 p-2">
                    <div className="flex flex-col space-y-0.5">
                      <p className="text-sm font-medium">{profile?.full_name || 'User'}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                      <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2 cursor-pointer">
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={signOut}
                    className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Link to="/auth">
                <Button variant="ghost" size="sm">Sign in</Button>
              </Link>
              <Link to="/auth?mode=signup">
                <Button size="sm">Get Started</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
