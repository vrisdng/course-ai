import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';
import { 
  GraduationCap, 
  MessageSquare, 
  FileText, 
  BarChart3, 
  BookOpen,
  CheckCircle2,
  ArrowRight,
  Sparkles
} from 'lucide-react';

export default function Landing() {
  const { user, isLecturer, isAdmin } = useAuth();

  const features = [
    {
      icon: MessageSquare,
      title: 'AI-Powered Q&A',
      description: 'Ask questions about course materials and get accurate, cited answers instantly.',
    },
    {
      icon: FileText,
      title: 'Source Citations',
      description: 'Every answer includes references to exact locations in your course materials.',
    },
    {
      icon: BookOpen,
      title: 'Personal Notes',
      description: 'Upload your own study notes and get personalized AI assistance.',
    },
    {
      icon: BarChart3,
      title: 'Learning Analytics',
      description: 'Lecturers can track common questions and identify areas where students struggle.',
    },
  ];

  const benefits = [
    'Answers grounded in actual course content',
    'Clear citations with page numbers and excerpts',
    'Private document uploads for personal study',
    'Conversation history across sessions',
    'Works with PDFs, slides, and transcripts',
    'Secure role-based access control',
  ];

  return (
    <MainLayout>
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
        <div className="container relative py-20 md:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-1.5 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              AI-Powered Learning Assistant
            </div>
            
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl">
              Learn Smarter with{' '}
              <span className="text-primary">Cited Answers</span>
            </h1>
            
            <p className="mb-8 text-lg text-muted-foreground md:text-xl">
              Ask questions about your course materials and get accurate answers with direct citations. 
              Every response is grounded in your actual learning content.
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              {user ? (
                <Link to={isAdmin ? '/admin-dashboard' : isLecturer ? '/lecturer' : '/chat'}>
                  <Button size="lg" className="gap-2">
                    Go to {isAdmin ? 'Admin' : isLecturer ? 'Dashboard' : 'Chat'}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/auth?mode=signup">
                    <Button size="lg" className="gap-2">
                      Get Started Free
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link to="/auth">
                    <Button variant="outline" size="lg">
                      Sign In
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="border-t border-border bg-muted/30 py-20">
        <div className="container">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground">
              Everything You Need to Learn Effectively
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              A complete learning assistant that helps students find answers and lecturers understand their students.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-foreground">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20">
        <div className="container">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="mb-6 text-3xl font-bold text-foreground">
                Answers You Can Trust
              </h2>
              <p className="mb-8 text-muted-foreground">
                Unlike generic AI chatbots, EduChat grounds every answer in your actual course materials. 
                See exactly where information comes from with clear citations.
              </p>
              
              <ul className="space-y-3">
                {benefits.map((benefit) => (
                  <li key={benefit} className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                    <span className="text-foreground">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-lg">
                <div className="mb-4 flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <GraduationCap className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-medium text-foreground">EduChat Assistant</span>
                </div>
                <div className="space-y-4">
                  <div className="rounded-lg bg-muted p-4">
                    <p className="text-sm text-foreground">
                      "Based on your course materials, the concept of machine learning involves..."
                    </p>
                  </div>
                  <div className="citation-card">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText className="h-3 w-3" />
                      <span>Week 3 - ML Fundamentals.pdf</span>
                      <span className="ml-auto">Page 12</span>
                    </div>
                    <p className="mt-2 text-sm text-foreground">
                      "Machine learning is a subset of artificial intelligence that enables systems to learn..."
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border bg-primary py-16">
        <div className="container text-center">
          <h2 className="mb-4 text-3xl font-bold text-primary-foreground">
            Ready to Transform Your Learning?
          </h2>
          <p className="mb-8 text-primary-foreground/80">
            Join students and lecturers who are already using AI to enhance education.
          </p>
          {!user && (
            <Link to="/auth?mode=signup">
              <Button size="lg" variant="secondary" className="gap-2">
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      </section>
    </MainLayout>
  );
}
