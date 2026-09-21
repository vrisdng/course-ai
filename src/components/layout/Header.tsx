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
import { BarChart3, LayoutDashboard, LogOut, MessageSquare, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

interface NavLink {
  to: string;
  label: string;
  icon: typeof MessageSquare;
  adminOnly?: boolean;
}

/** Primary in-app destinations. Shown as buttons on desktop and as menu items on phones. */
const NAV_LINKS: NavLink[] = [
  { to: '/admin-dashboard', label: 'Admin', icon: LayoutDashboard, adminOnly: true },
  { to: '/admin-analytics', label: 'Analytics', icon: BarChart3, adminOnly: true },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
];

export function Header() {
  const { user, profile, signOut, isAdmin } = useAuth();

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  const visibleLinks = NAV_LINKS.filter((link) => !link.adminOnly || isAdmin);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between gap-3">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <img src="/logo.png" alt="EduChat logo" className="h-9 w-9 shrink-0 object-contain" />
          <span className="truncate text-lg font-semibold text-foreground sm:text-xl">EduChat</span>
        </Link>

        <nav className="flex shrink-0 items-center gap-1 sm:gap-4">
          {user ? (
            <>
              {/* Desktop: inline text links. Phones: the same links live inside the avatar menu. */}
              {visibleLinks.map((link) => (
                <Link key={link.to} to={link.to} className="hidden md:block">
                  <Button variant="ghost" size="sm">
                    {link.label}
                  </Button>
                </Link>
              ))}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full" aria-label="Open account menu">
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
                    <div className="flex min-w-0 flex-col space-y-0.5">
                      <p className="truncate text-sm font-medium">{profile?.full_name || 'User'}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  {visibleLinks.map((link) => (
                    <DropdownMenuItem key={link.to} asChild className="md:hidden">
                      <Link to={link.to} className="flex items-center gap-2 cursor-pointer">
                        <link.icon className="h-4 w-4" />
                        {link.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator className="md:hidden" />
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
