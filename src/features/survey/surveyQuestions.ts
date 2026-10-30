export type SurveySectionId = 'ux' | 'quality' | 'bugs' | 'features';

export type SurveyInputKind = 'scale' | 'choice' | 'open' | 'matrix';

export interface SurveyQuestion {
  id: string;
  number: number;
  section: SurveySectionId;
  prompt: string;
  kind: SurveyInputKind;
  options?: readonly string[];
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  features?: readonly string[];
  placeholder?: string;
  rows?: number;
}

export interface SurveySection {
  id: SurveySectionId;
  title: string;
  description: string;
}

export interface SurveyAnswerPayload {
  question: string;
  answer: string;
}

export const SURVEY_SECTIONS: readonly SurveySection[] = [
  {
    id: 'ux',
    title: 'User experience',
    description: 'How easy and enjoyable CEEGPT was to use.',
  },
  {
    id: 'quality',
    title: 'AI answer quality',
    description: 'How accurate and trustworthy the assistant’s answers felt.',
  },
  {
    id: 'bugs',
    title: 'Bugs and unexpected behaviour',
    description: 'Anything that broke or did not work the way you expected.',
  },
  {
    id: 'features',
    title: 'Features you want',
    description: 'What would make CEEGPT more useful for you.',
  },
];

export const SURVEY_FEATURES = [
  'Mobile use',
  'Image or scan uploads',
  'More file formats',
  'Offline access',
  'Group study',
  'Export notes',
  'Progress tracking',
] as const;

export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = [
  {
    id: 'first-answer-ease',
    number: 1,
    section: 'ux',
    prompt: 'How easy was it to get your first useful answer?',
    kind: 'scale',
    min: 1,
    max: 5,
    minLabel: 'Very hard',
    maxLabel: 'Very easy',
  },
  {
    id: 'first-task',
    number: 2,
    section: 'ux',
    prompt: 'Which task did you try first?',
    kind: 'choice',
    options: ['Chat with materials', 'Upload material', 'Enroll students', 'View analytics', 'Other'],
  },
  {
    id: 'completed-without-help',
    number: 3,
    section: 'ux',
    prompt: 'Did you complete it without help?',
    kind: 'choice',
    options: ['Yes', 'Partly', 'No'],
  },
  {
    id: 'overall-satisfaction',
    number: 4,
    section: 'ux',
    prompt: 'Overall, how satisfied are you with using the app?',
    kind: 'scale',
    min: 1,
    max: 5,
    minLabel: 'Very dissatisfied',
    maxLabel: 'Very satisfied',
  },
  {
    id: 'frustrating-moment',
    number: 5,
    section: 'ux',
    prompt: 'What was the most frustrating moment?',
    kind: 'open',
    placeholder: 'Describe one moment in a sentence or two.',
  },
  {
    id: 'recommend',
    number: 6,
    section: 'ux',
    prompt: 'How likely are you to recommend it to a classmate or colleague?',
    kind: 'scale',
    min: 0,
    max: 10,
    minLabel: 'Not likely',
    maxLabel: 'Very likely',
  },
  {
    id: 'materials-accuracy',
    number: 7,
    section: 'quality',
    prompt: 'How often did answers correctly reflect the course materials?',
    kind: 'choice',
    options: ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'],
  },
  {
    id: 'answered-question',
    number: 8,
    section: 'quality',
    prompt: 'Did the assistant answer what you actually asked?',
    kind: 'scale',
    min: 1,
    max: 5,
    minLabel: 'Missed it',
    maxLabel: 'Nailed it',
  },
  {
    id: 'unsupported-info',
    number: 9,
    section: 'quality',
    prompt: 'How often did it give wrong, made-up, or unsupported information?',
    kind: 'choice',
    options: ['Never', 'Rarely', 'Sometimes', 'Often'],
  },
  {
    id: 'citation-check',
    number: 10,
    section: 'quality',
    prompt: 'Did you open a cited source? If yes, did it back up the answer?',
    kind: 'choice',
    options: ["I didn't open one", 'Yes, it backed up the answer', 'No, it did not'],
  },
  {
    id: 'model-tier',
    number: 11,
    section: 'quality',
    prompt: 'Was Fast vs Smart vs Pro quality worth the wait?',
    kind: 'choice',
    options: ['Too slow', 'About right', 'Worth it', "Can't tell"],
  },
  {
    id: 'compare-chatgpt',
    number: 12,
    section: 'quality',
    prompt: 'In your own words, how does it compare to just using ChatGPT for this course?',
    kind: 'open',
    placeholder: 'Share whatever stands out to you.',
  },
  {
    id: 'hit-broken',
    number: 13,
    section: 'bugs',
    prompt: 'Did you hit anything broken or that behaved unexpectedly?',
    kind: 'choice',
    options: ['Yes', 'No'],
  },
  {
    id: 'bug-description',
    number: 14,
    section: 'bugs',
    prompt: 'If yes, describe it and when it happened.',
    kind: 'open',
    placeholder: 'One issue per line is perfect.',
    rows: 4,
  },
  {
    id: 'bug-impact',
    number: 15,
    section: 'bugs',
    prompt: 'Did it stop you from finishing your task?',
    kind: 'choice',
    options: ['Blocked me', 'Slowed me', 'Cosmetic only'],
  },
  {
    id: 'bug-frequency',
    number: 16,
    section: 'bugs',
    prompt: 'How often did it happen?',
    kind: 'choice',
    options: ['Once', 'A few times', 'Every time'],
  },
  {
    id: 'wanted-feature',
    number: 17,
    section: 'features',
    prompt: 'What feature would most improve your experience?',
    kind: 'open',
    placeholder: 'Describe the feature you would find most useful.',
  },
  {
    id: 'feature-importance',
    number: 18,
    section: 'features',
    prompt: 'Rate the importance of each of the following.',
    kind: 'matrix',
    min: 1,
    max: 5,
    minLabel: 'Not important',
    maxLabel: 'Very important',
    features: SURVEY_FEATURES,
  },
  {
    id: 'use-more-often',
    number: 19,
    section: 'features',
    prompt: 'What would make you use this more often?',
    kind: 'open',
    placeholder: 'Anything that would make CEEGPT part of your routine.',
  },
  {
    id: 'anything-else',
    number: 20,
    section: 'features',
    prompt: 'Anything else we should know?',
    kind: 'open',
    placeholder: 'Add any final thoughts here.',
  },
];

export function matrixAnswerKey(questionId: string, feature: string): string {
  return `${questionId}:${feature}`;
}

export function buildSurveyAnswers(values: Record<string, string>): SurveyAnswerPayload[] {
  const answers: SurveyAnswerPayload[] = [];

  for (const question of SURVEY_QUESTIONS) {
    if (question.kind === 'matrix') {
      for (const feature of question.features ?? []) {
        const answer = values[matrixAnswerKey(question.id, feature)]?.trim();
        if (answer) {
          answers.push({
            question: `${question.number}. ${question.prompt} — ${feature}`,
            answer,
          });
        }
      }
      continue;
    }

    const answer = values[question.id]?.trim();
    if (answer) {
      answers.push({
        question: `${question.number}. ${question.prompt}`,
        answer,
      });
    }
  }

  return answers;
}
