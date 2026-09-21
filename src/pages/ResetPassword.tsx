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
import { AlertCircle, CheckCircle2, GraduationCap, KeyRound, Loader2, Lock, Mail } from 'lucide-react';

const verifyCodeSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  code: z.string().regex(/^\d{6,10}$/, 'Enter the numeric code from the email'),
});

const newPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type VerifyCodeFormData = z.infer<typeof verifyCodeSchema>;
type NewPasswordFormData = z.infer<typeof newPasswordSchema>;

// How long the success message stays visible before redirecting.
const REDIRECT_DELAY_MS = 500;

// Older recovery emails carried a one-time link. If one of those is opened
// after being consumed, Supabase reports the problem as URL parameters rather
// than an auth event, so the page reads them to show a useful message.
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

  // The forgot-password form hands the email over via router state so it is
  // not exposed in the URL; the field stays editable for direct visits.
  const handedOverEmail = ((location.state as { email?: string } | null)?.email ?? '').trim().toLowerCase();

  const verifyForm = useForm<VerifyCodeFormData>({
    resolver: zodResolver(verifyCodeSchema),
    defaultValues: { email: handedOverEmail, code: '' },
  });

  const passwordForm = useForm<NewPasswordFormData>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (!successMessage) return;
    const destination = profile?.role === 'admin' ? '/admin-dashboard' : '/chat';
    const handle = window.setTimeout(() => navigate(destination, { replace: true }), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [successMessage, profile, navigate]);

  const handleVerifyCode = async (data: VerifyCodeFormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Supabase OTP length is a project setting (6-10 digits), so the
      // exact length is not enforced here.
      // A successful verification establishes a session; the auth context
      // picks it up and this page switches to the new-password form.
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: data.email.trim().toLowerCase(),
        token: data.code,
        type: 'recovery',
      });
      if (verifyError) {
        setError(verifyError.message);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdatePassword = async (data: NewPasswordFormData) => {
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

  const hasSession = Boolean(user);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary/5 to-background p-4">
      <Link to="/" className="mb-8 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
          <GraduationCap className="h-6 w-6 text-primary-foreground" />
        </div>
        <span className="text-2xl font-bold text-foreground">EduChat</span>
      </Link>

      <Card className="w-full max-w-md">
        {hasSession ? (
          <form onSubmit={passwordForm.handleSubmit(handleUpdatePassword)}>
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
                    {...passwordForm.register('password')}
                  />
                </div>
                {passwordForm.formState.errors.password && (
                  <p className="text-sm text-destructive">{passwordForm.formState.errors.password.message}</p>
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
                    {...passwordForm.register('confirmPassword')}
                  />
                </div>
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-destructive">{passwordForm.formState.errors.confirmPassword.message}</p>
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
          <form onSubmit={verifyForm.handleSubmit(handleVerifyCode)}>
            <CardHeader>
              <CardTitle>Enter your reset code</CardTitle>
              <CardDescription>
                {handedOverEmail
                  ? `We emailed a one-time code to ${handedOverEmail}. It expires in 60 minutes.`
                  : 'Enter the email for your account and the one-time code from the reset email.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(error || linkError) && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error ?? linkError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@university.edu"
                    className="pl-10"
                    {...verifyForm.register('email')}
                  />
                </div>
                {verifyForm.formState.errors.email && (
                  <p className="text-sm text-destructive">{verifyForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-code">Verification Code</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="reset-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={10}
                    placeholder="12345678"
                    className="pl-10 tracking-[0.3em]"
                    {...verifyForm.register('code')}
                  />
                </div>
                {verifyForm.formState.errors.code && (
                  <p className="text-sm text-destructive">{verifyForm.formState.errors.code.message}</p>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify Code'
                )}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Didn't get it?{' '}
                <Link to="/auth?mode=forgot" className="font-medium text-primary hover:underline">
                  Request a new code
                </Link>
              </p>
              <Button asChild variant="ghost" className="w-full">
                <Link to="/auth">Back to Sign In</Link>
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
