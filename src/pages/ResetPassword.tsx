import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, GraduationCap, Loader2, Lock } from 'lucide-react';

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

// How long the success message stays visible before redirecting.
const REDIRECT_DELAY_MS = 500;

// Supabase reports link problems (expired, already used) as URL parameters in
// either the hash (implicit flow) or the query string (PKCE flow) rather than
// via an auth event, so the page reads them directly.
function readAuthErrorFromLocation(location: { hash: string; search: string }): string | null {
  for (const raw of [location.hash.replace(/^#/, ''), location.search.replace(/^\?/, '')]) {
    if (!raw) continue;
    const params = new URLSearchParams(raw);
    const description = params.get('error_description');
    if (description) {
      return description.replace(/\+/g, ' ');
    }
    if (params.get('error')) {
      return 'This password reset link is invalid or has expired.';
    }
  }
  return null;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, isLoading: authLoading } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Captured once on mount: the Supabase client may strip these from the URL
  // after it finishes processing the callback.
  const linkError = useMemo(
    () => readAuthErrorFromLocation({ hash: location.hash, search: location.search }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (!successMessage) return;
    const destination = profile?.role === 'admin' ? '/admin-dashboard' : '/chat';
    const handle = window.setTimeout(() => navigate(destination, { replace: true }), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [successMessage, profile, navigate]);

  const handleSubmit = async (data: ResetPasswordFormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: data.password });
      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccessMessage('Password updated. Redirecting you now...');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasRecoverySession = Boolean(user);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary/5 to-background p-4">
      <Link to="/" className="mb-8 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
          <GraduationCap className="h-6 w-6 text-primary-foreground" />
        </div>
        <span className="text-2xl font-bold text-foreground">EduChat</span>
      </Link>

      <Card className="w-full max-w-md">
        {hasRecoverySession ? (
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <CardHeader>
              <CardTitle>Choose a new password</CardTitle>
              <CardDescription>Enter and confirm the new password for your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {successMessage && (
                <Alert className="border-success/50 bg-success/10">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <AlertDescription className="text-success">{successMessage}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="reset-password">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="reset-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-10"
                    {...form.register('password')}
                  />
                </div>
                {form.formState.errors.password && (
                  <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-confirm-password">Confirm New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="reset-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-10"
                    {...form.register('confirmPassword')}
                  />
                </div>
                {form.formState.errors.confirmPassword && (
                  <p className="text-sm text-destructive">{form.formState.errors.confirmPassword.message}</p>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={isSubmitting || Boolean(successMessage)}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Password'
                )}
              </Button>
            </CardFooter>
          </form>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Reset link not valid</CardTitle>
              <CardDescription>
                {linkError ?? 'This password reset link is invalid or has expired. Reset links can only be used once.'}
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link to="/auth?mode=forgot">Request a new link</Link>
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link to="/auth">Back to Sign In</Link>
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}
