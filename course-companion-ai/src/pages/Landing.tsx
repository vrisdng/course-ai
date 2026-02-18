import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';

type InviteCheckResponse = {
  valid: boolean;
  reason: 'ok' | 'not_found' | 'expired' | 'redeemed';
  invitedEmail?: string;
  course?: {
    id: string;
    name: string;
    code: string | null;
  };
  expiresAt?: string;
  emailMatchesInvite?: boolean;
  accountExists?: boolean;
  alreadyEnrolled?: boolean;
};

const getInviteError = (reason: InviteCheckResponse['reason'] | undefined) => {
  if (reason === 'expired') return 'This invite has expired.';
  if (reason === 'redeemed') return 'This invite has already been used.';
  return 'This invite code is invalid.';
};

export default function Landing() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAdmin, user, profile, isLoading: authLoading, refreshProfile } = useAuth();
  const inviteCode = (searchParams.get('invite') || '').trim();
  const inviteEmailParam = (searchParams.get('email') || '').trim().toLowerCase();

  const [inviteEmailInput, setInviteEmailInput] = useState(inviteEmailParam);
  const [inviteInfo, setInviteInfo] = useState<InviteCheckResponse | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isCheckingInvite, setIsCheckingInvite] = useState(false);
  const [isRedeemingInvite, setIsRedeemingInvite] = useState(false);
  const [hasCheckedEmailState, setHasCheckedEmailState] = useState(false);

  useEffect(() => {
    setInviteEmailInput(inviteEmailParam);
  }, [inviteEmailParam]);

  const evaluateInvite = useCallback(
    async (email?: string) => {
      if (!inviteCode) {
        return;
      }

      setIsCheckingInvite(true);
      setInviteError(null);

      const emailForRequest = email?.trim().toLowerCase();
      const { data, error } = await supabase.functions.invoke('check-course-invite', {
        body: {
          inviteCode,
          ...(emailForRequest ? { email: emailForRequest } : {}),
        },
      });

      setIsCheckingInvite(false);

      if (error) {
        setInviteError(error.message || 'Could not validate invite code.');
        setInviteInfo(null);
        return;
      }

      if (data?.error) {
        setInviteError(data.error);
        setInviteInfo(null);
        return;
      }

      const parsed = data as InviteCheckResponse;
      setInviteInfo(parsed);
      if (!parsed.valid) {
        setInviteError(getInviteError(parsed.reason));
        return;
      }

      setInviteError(null);
    },
    [inviteCode]
  );

  useEffect(() => {
    if (!inviteCode || authLoading) {
      return;
    }

    if (user && profile?.email) {
      setHasCheckedEmailState(true);
      void evaluateInvite(profile.email);
      return;
    }

    if (inviteEmailParam) {
      setHasCheckedEmailState(true);
      void evaluateInvite(inviteEmailParam);
      return;
    }

    void evaluateInvite();
  }, [authLoading, evaluateInvite, inviteCode, inviteEmailParam, profile?.email, user]);

  const authLink = useMemo(() => {
    const params = new URLSearchParams();
    params.set('invite', inviteCode);
    if (inviteEmailInput.trim()) {
      params.set('email', inviteEmailInput.trim().toLowerCase());
    }
    return params.toString();
  }, [inviteCode, inviteEmailInput]);

  const handleCheckEmail = async () => {
    const normalizedEmail = inviteEmailInput.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error('Enter your email first');
      return;
    }

    setHasCheckedEmailState(true);
    await evaluateInvite(normalizedEmail);
  };

  const handleRedeemInvite = async () => {
    if (!inviteCode) {
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) {
      toast.error('Please sign in first');
      navigate(`/auth?mode=signin&invite=${encodeURIComponent(inviteCode)}&email=${encodeURIComponent(inviteEmailInput.trim().toLowerCase())}`);
      return;
    }

    setIsRedeemingInvite(true);
    const { data, error } = await supabase.functions.invoke('redeem-course-invite', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: { inviteCode },
    });
    setIsRedeemingInvite(false);

    if (error) {
      toast.error(error.message || 'Failed to enroll with invite');
      return;
    }

    if (data?.error) {
      toast.error(data.error);
      return;
    }

    await refreshProfile();
    if (user?.email) {
      await evaluateInvite(user.email);
    } else {
      await evaluateInvite();
    }
    toast.success(data?.status === 'already_enrolled' ? 'You are already enrolled in this course.' : 'You have been enrolled.');
    navigate('/chat');
  };

  const showInviteCard = Boolean(inviteCode);
  const inviteCourseLabel = inviteInfo?.course
    ? `${inviteInfo.course.name}${inviteInfo.course.code ? ` (${inviteInfo.course.code})` : ''}`
    : 'Course';
  const canRedeemNow =
    Boolean(user) &&
    inviteInfo?.valid &&
    inviteInfo.emailMatchesInvite !== false &&
    inviteInfo.alreadyEnrolled !== true;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">EduChat</h1>
          <p className="text-muted-foreground">
            Ask questions about your course materials and get grounded answers with citations.
          </p>
        </div>

        {showInviteCard && (
          <Card className="w-full text-left">
            <CardHeader>
              <CardTitle>Course Enrollment Invite</CardTitle>
              <CardDescription>Use this invite to enroll in {inviteCourseLabel}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isCheckingInvite ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking invite...
                </div>
              ) : null}

              {inviteError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{inviteError}</AlertDescription>
                </Alert>
              )}

              {!inviteError && inviteInfo?.valid && (
                <>
                  <Alert className="border-success/50 bg-success/10">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <AlertDescription className="text-success">
                      Invite code is valid for {inviteInfo.invitedEmail}.
                    </AlertDescription>
                  </Alert>

                  {!user ? (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="invite-email">Your email</Label>
                        <Input
                          id="invite-email"
                          type="email"
                          value={inviteEmailInput}
                          onChange={(event) => setInviteEmailInput(event.target.value)}
                          placeholder="you@university.edu"
                        />
                      </div>

                      <Button type="button" variant="outline" onClick={() => void handleCheckEmail()} disabled={isCheckingInvite}>
                        Check My Account
                      </Button>

                      {hasCheckedEmailState && inviteInfo.emailMatchesInvite === false && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>This invite is for a different email address.</AlertDescription>
                        </Alert>
                      )}

                      {hasCheckedEmailState && inviteInfo.emailMatchesInvite !== false && inviteInfo.alreadyEnrolled && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">
                            You already enrolled in this course. Sign in to continue.
                          </p>
                          <Link to={`/auth?mode=signin&email=${encodeURIComponent(inviteEmailInput.trim().toLowerCase())}`}>
                            <Button type="button">Go to Sign In</Button>
                          </Link>
                        </div>
                      )}

                      {hasCheckedEmailState &&
                        inviteInfo.emailMatchesInvite !== false &&
                        !inviteInfo.alreadyEnrolled &&
                        inviteInfo.accountExists === true && (
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                              Account found. Sign in and we will enroll you immediately.
                            </p>
                            <Link to={`/auth?mode=signin&${authLink}`}>
                              <Button type="button">Sign In to Enroll</Button>
                            </Link>
                          </div>
                        )}

                      {hasCheckedEmailState &&
                        inviteInfo.emailMatchesInvite !== false &&
                        !inviteInfo.alreadyEnrolled &&
                        inviteInfo.accountExists === false && (
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                              No account found. Create one, then we will enroll you in this course.
                            </p>
                            <Link to={`/auth?mode=signup&${authLink}`}>
                              <Button type="button">Create Account and Enroll</Button>
                            </Link>
                          </div>
                        )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Signed in as {profile?.email || user.email || 'your account'}.
                      </p>

                      {inviteInfo.emailMatchesInvite === false && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>This invite belongs to another email account.</AlertDescription>
                        </Alert>
                      )}

                      {inviteInfo.alreadyEnrolled && (
                        <Alert>
                          <CheckCircle2 className="h-4 w-4 text-success" />
                          <AlertDescription>You are already enrolled in this course.</AlertDescription>
                        </Alert>
                      )}

                      {canRedeemNow && (
                        <Button type="button" onClick={() => void handleRedeemInvite()} disabled={isRedeemingInvite}>
                          {isRedeemingInvite ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Enrolling...
                            </>
                          ) : (
                            'Enroll Now'
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

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
