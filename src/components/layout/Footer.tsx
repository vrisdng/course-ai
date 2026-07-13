import { GraduationCap } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container py-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <GraduationCap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">EduChat</span>
          </div>

          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} EduChat. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
