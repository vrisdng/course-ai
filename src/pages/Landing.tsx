import { CheckCircle2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

export default function Landing() {
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const showRetiredInvite = searchParams.has('invite');

  const primaryCta = isAdmin
    ? { to: '/admin-dashboard', label: 'Open dashboard' }
    : { to: '/chat', label: 'Open chat' };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-baseline gap-1">
            <img src="/ceegpt_logo.svg" alt="" className="mr-2 h-6 w-6" />
            <span className="text-lg font-semibold tracking-tight">CEEGPT</span>
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
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pb-20 pt-16 md:pt-24">
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

      {showRetiredInvite && (
        <section id="access" className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
          <Card className="mx-auto w-full max-w-xl rounded-none border-border text-left">
            <CardHeader>
              <CardTitle>Course invitation links have been retired.</CardTitle>
              <CardDescription>Contact your lecturer to be added to your course using your email and name.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild><Link to="/auth?mode=signin">Sign in</Link></Button>
            </CardContent>
          </Card>
        </section>
      )}

      {/* How it works — a real sequence, so numbered markers earn their place */}
      <section id="how" className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-24">
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
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 py-24 md:grid-cols-2">
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
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-24 text-center">
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
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:px-6 py-10 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/ceegpt_logo.svg" alt="" className="h-5 w-5" />
            <span className="font-medium text-foreground">CEEGPT</span>
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
