import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
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

type RedeemInviteResponse = {
  success?: boolean;
  status?: 'already_enrolled' | 'enrolled';
  courseId?: string;
  error?: string;
};

const redeemCourseInvite = async (_accessToken: string, inviteCode: string): Promise<RedeemInviteResponse> => {
  const { data, error } = await supabase.functions.invoke('redeem-course-invite', {
    body: { inviteCode },
  });

  if (error) {
    throw new Error(error.message || 'Failed to enroll with invite');
  }

  return (data as RedeemInviteResponse) || {};
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
    try {
      const data = await redeemCourseInvite(accessToken, inviteCode);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enroll with invite';
      toast.error(message);
    } finally {
      setIsRedeemingInvite(false);
    }
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

  const primaryCta = isAdmin
    ? { to: '/admin-dashboard', label: 'Open dashboard' }
    : { to: '/chat', label: 'Open chat' };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-baseline gap-1">
            <img src="/logo.png" alt="" className="mr-2 h-6 w-6" />
            <span className="text-lg font-semibold tracking-tight">EduChat</span>
            <span className="mono-label mt-0 text-[0.6rem] leading-none">™</span>
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#how" className="text-sm text-muted-foreground transition-colors hover:text-foreground">How it works</a>
            <a href="#courses" className="text-sm text-muted-foreground transition-colors hover:text-foreground">For courses</a>
            <a href="#access" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Access</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/auth?mode=signin" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Sign in
            </Link>
            <Link to={primaryCta.to}>
              <button className="pill bg-primary text-primary-foreground hover:bg-primary/90">{primaryCta.label}</button>
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-grid">
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 particle-field md:block" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-px w-8 bg-foreground/40" />
            <span className="mono-label">Simple answers from your course</span>
          </div>
          <h1 className="display-xl max-w-4xl text-foreground">
            Learn from
            <br />
            your materials
          </h1>
          <p className="mt-8 max-w-xl text-lg text-muted-foreground">
            Ask a question and get a short answer from your lectures, readings, and slides.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link to={primaryCta.to}>
              <button className="pill bg-primary text-primary-foreground hover:bg-primary/90">{primaryCta.label}</button>
            </Link>
            <a href="#how">
              <button className="pill border border-border bg-background hover:bg-accent">How it works</button>
            </a>
          </div>
        </div>
      </section>

      {/* Invite card — shown inline when arriving via an enrollment link */}
      {showInviteCard && (
        <section id="access" className="mx-auto max-w-6xl px-6 py-12">
          <Card className="mx-auto w-full max-w-xl rounded-none border-border text-left">
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
        </section>
      )}

      {/* How it works — a real sequence, so numbered markers earn their place */}
      <section id="how" className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <span className="mono-label text-primary-foreground/60">How it works</span>
          <div className="mt-12 grid gap-px overflow-hidden border border-primary-foreground/15 bg-primary-foreground/15 md:grid-cols-3">
            {[
              {
                n: '01',
                t: 'Upload course files',
                d: 'Add lectures, slides, and readings.',
              },
              {
                n: '02',
                t: 'Ask a question',
                d: 'Type your question in plain language.',
              },
              {
                n: '03',
                t: 'Open the source',
                d: 'See where the answer came from.',
              },
            ].map((step) => (
              <div key={step.n} className="bg-primary p-8">
                <span className="mono-label text-primary-foreground/50">{step.n}</span>
                <h3 className="mt-6 text-xl font-medium">{step.t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-primary-foreground/70">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For courses */}
      <section id="courses" className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:grid-cols-2">
          <div>
            <span className="mono-label">For courses</span>
            <h2 className="mt-6 max-w-md text-3xl font-medium tracking-tight md:text-4xl">
              Clear answers for class.
            </h2>
          </div>
          <ul className="space-y-6">
            {[
              ['From your materials', 'Use what your instructor uploaded.'],
              ['Cited answers', 'Every response links back to a source.'],
              ['No guessing', 'If it is not in the course, it says so.'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-4 border-t border-border pt-6">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">{t}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-border bg-grid">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h2 className="display-xl mx-auto max-w-3xl text-foreground" style={{ fontSize: 'clamp(2.5rem, 7vw, 5rem)' }}>
            Start asking
          </h2>
          <div className="mt-10 flex justify-center gap-3">
            <Link to={primaryCta.to}>
              <button className="pill bg-primary text-primary-foreground hover:bg-primary/90">{primaryCta.label}</button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-5 w-5" />
            <span className="font-medium text-foreground">EduChat</span>
          </div>
          <div className="flex flex-col items-center gap-1 sm:items-end">
            <span className="mono-label">Grounded course answers</span>
            <a href="https://moworld.me/" target="_blank" rel="noreferrer" className="text-foreground transition-colors hover:text-primary">
              Developed by Duong Ngoc Mai
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
