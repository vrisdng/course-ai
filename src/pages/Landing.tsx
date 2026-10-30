import { ArrowRight, BookOpen, Check, FileText, GraduationCap, Loader2, MessageSquare, Play, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import '@/features/landing/landing.css';

const benefits = [
  { icon: MessageSquare, color: 'blue', title: 'Answers with sources', description: 'Follow citations back to the course material behind an answer.' },
  { icon: BookOpen, color: 'green', title: 'Notes and webcasts', description: 'Find the right page or moment in your course materials.' },
  { icon: GraduationCap, color: 'purple', title: 'Built for your course', description: 'Learn from materials your lecturer has shared with your class.' },
];

export default function Landing() {
  const [searchParams] = useSearchParams();
  const { user, profile, isLoading } = useAuth();

  if (isLoading || (user && !profile?.role)) {
    return <div className="landing-page landing-loading" role="status"><Loader2 className="motion-safe:animate-spin" aria-hidden="true" />Loading your account…</div>;
  }
  if (user) return <Navigate to={profile.role === 'admin' ? '/admin-dashboard' : '/chat'} replace />;

  return (
    <div className="landing-page">
      <a className="landing-skip" href="#main">Skip to content</a>
      <header className="landing-header">
        <nav className="landing-container landing-nav" aria-label="Main navigation">
          <Link to="/" className="landing-brand" aria-label="CEEGPT home">
            <img src="/ceegpt_logo.svg" alt="" width="38" height="38" />
            <span>CEEGPT</span>
          </Link>
          <span className="landing-nav-caption">Your course AI companion</span>
          <div className="landing-nav-links">
            <a href="#how">How it works</a>
            <a href="#courses">For lecturers</a>
            <a href="#access">Access</a>
          </div>
          <Button asChild className="landing-primary landing-nav-cta"><Link to="/auth?mode=signin">Sign in<ArrowRight aria-hidden="true" /></Link></Button>
        </nav>
      </header>

      <main id="main">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow"><span aria-hidden="true" />YOUR COURSE. A LITTLE CLEARER.</p>
              <h1 id="hero-title">Learn better<br />with <span>course AI.</span></h1>
              <p className="landing-intro">Big questions. Clearer understanding. Ask about your course and explore answers grounded in your notes and webcasts, with sources you can check.</p>
              <div className="landing-hero-actions">
                <Button asChild size="lg" className="landing-primary"><Link to="/auth?mode=signin">Sign in to start learning<ArrowRight aria-hidden="true" /></Link></Button>
                <a className="landing-text-link" href="#how">See how it works<ArrowRight aria-hidden="true" /></a>
              </div>
              <div className="landing-benefits">
                {benefits.map(({ icon: Icon, color, title, description }) => (
                  <div className="landing-benefit" key={title}>
                    <span className={`landing-icon landing-icon-${color}`}><Icon aria-hidden="true" /></span>
                    <div><h2>{title}</h2><p>{description}</p></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="landing-hero-preview">
              <figure className="landing-demo">
                <figcaption>Illustrative course conversation</figcaption>
                <div className="landing-demo-orbit" aria-hidden="true" />
                <div className="landing-float landing-question"><div className="landing-demo-card">How do Scope 1 and Scope 2 emissions differ?</div></div>
                <div className="landing-float landing-answer">
                  <div className="landing-demo-card">
                    <span className="landing-answer-label"><Sparkles size={17} aria-hidden="true" />CEEGPT</span>
                    <p><strong>Scope 1</strong> covers direct emissions from sources an organisation owns or controls. <strong>Scope 2</strong> covers indirect emissions from purchased energy.</p>
                    <span className="landing-source-label">From your course materials</span>
                    <div className="landing-source"><FileText size={14} aria-hidden="true" />Lecture notes · Page 12<span>1</span></div>
                    <div className="landing-source"><Play size={14} aria-hidden="true" />Week 3 webcast · 08:24<span>2</span></div>
                  </div>
                </div>
                <div className="landing-float landing-notes"><div className="landing-demo-card landing-mini-card"><span className="landing-icon landing-icon-green"><FileText aria-hidden="true" /></span><div><strong>Notes</strong><span>Find the right page</span></div></div></div>
                <div className="landing-float landing-webcast"><div className="landing-demo-card landing-mini-card"><span className="landing-icon landing-icon-purple"><Play aria-hidden="true" /></span><div><strong>Webcast</strong><span>Revisit the moment</span></div></div></div>
              </figure>

              <section id="access" className="landing-access" aria-labelledby="access-title">
                <div className="landing-access-heading"><span className="landing-icon landing-icon-blue"><GraduationCap aria-hidden="true" /></span><span>ONE PLACE FOR YOUR LEARNING</span></div>
                <h2 id="access-title">Welcome to CEEGPT</h2>
                <p>Use your email and password to access your courses.</p>
                <Button asChild size="lg" className="landing-primary"><Link to="/auth?mode=signin">Sign in to your account<ArrowRight aria-hidden="true" /></Link></Button>
                <div className="landing-access-note"><ShieldCheck aria-hidden="true" /><p>Your lecturer manages course enrollment. If you need access, ask them to add your email and name.</p></div>
              </section>
            </div>
          </div>
        </section>

        {searchParams.has('invite') && (
          <aside className="landing-container landing-retired" aria-labelledby="retired-title">
            <ShieldCheck aria-hidden="true" /><div><h2 id="retired-title">Course invitation links have been retired.</h2><p>Contact your lecturer to be added to your course using your email and name.</p></div>
          </aside>
        )}

        <section id="how" className="landing-how" aria-labelledby="how-title">
          <div className="landing-container">
            <p className="landing-eyebrow">LESS SEARCHING. MORE UNDERSTANDING.</p>
            <h2 id="how-title">A question is a good place to start.</h2>
            <ol className="landing-steps">
              {[
                ['Choose your materials', 'Open your course and choose the notes or webcasts you want to explore.'],
                ['Ask in your own words', 'Get an explanation, connect ideas, or work through a topic that has not clicked yet.'],
                ['Check the source', 'Follow the citations to the original notes or webcast and revisit the explanation.'],
              ].map(([title, description], index) => <li key={title}><span className="landing-step-number">0{index + 1}</span><h3>{title}</h3><p>{description}</p></li>)}
            </ol>
          </div>
        </section>

        <section id="courses" className="landing-container landing-courses" aria-labelledby="courses-title">
          <div><p className="landing-eyebrow">FOR LECTURERS</p><h2 id="courses-title">Your course materials.<br />More ways to learn.</h2><p>Bring your teaching resources together and give students a starting point for their questions.</p></div>
          <ul>
            <li><Check aria-hidden="true" /><span><strong>Share notes and webcasts</strong>Upload PDFs and videos for your class to explore.</span></li>
            <li><Check aria-hidden="true" /><span><strong>Manage your courses</strong>Organise materials by course and academic term.</span></li>
            <li><Check aria-hidden="true" /><span><strong>Keep your class connected</strong>Add students by email and name, and review course usage.</span></li>
          </ul>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container"><span className="landing-brand"><img src="/ceegpt_logo.svg" alt="" width="26" height="26" />CEEGPT</span><p>A little clarity goes a long way.</p><p className="landing-credit">Developed by <a href="https://moworld.me/" target="_blank" rel="noreferrer">Duong Ngoc Mai</a> and Kavishwer Sathiamorthy</p></div>
      </footer>
    </div>
  );
}
