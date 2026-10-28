import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

import { SurveyQuestionField } from '@/features/survey/SurveyQuestionField';
import { buildSurveyAnswers, SURVEY_QUESTIONS, SURVEY_SECTIONS } from '@/features/survey/surveyQuestions';

const SUCCESS_MESSAGE = 'Thank you! Your response has been saved.';

export default function Survey() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const answers = buildSurveyAnswers(values);
    if (answers.length === 0) {
      toast.error('Please answer at least one question before submitting.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('submit-survey', {
        body: { answers },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setSubmitted(true);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : (error as { message?: string } | null)?.message
          || 'We could not save your response. Please try again.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <MainLayout>
        <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
          <CheckCircle2 className="mb-4 h-14 w-14 text-primary" aria-hidden="true" />
          <h1 className="mb-2 text-2xl font-bold">Feedback received</h1>
          <p className="mb-8 text-lg text-foreground">{SUCCESS_MESSAGE}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/chat">Back to chat</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setValues({});
                setSubmitted(false);
              }}
            >
              Submit another response
            </Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold sm:text-3xl">CEEGPT feedback survey</h1>
          </div>
          <p className="text-muted-foreground">
            Your responses will help improve CEEGPT and shape the experience of future students in the project.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            All questions are optional — answer only what you want to share.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-6">
            {SURVEY_SECTIONS.map((section) => (
              <Card key={section.id}>
                <CardHeader>
                  <CardTitle className="text-xl">{section.title}</CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-7">
                  {SURVEY_QUESTIONS.filter((question) => question.section === section.id).map((question) => (
                    <SurveyQuestionField
                      key={question.id}
                      question={question}
                      values={values}
                      onChange={handleChange}
                    />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setValues({})}
              disabled={isSubmitting}
            >
              Clear answers
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit feedback
            </Button>
          </div>
        </form>
      </div>
    </MainLayout>
  );
}
