export type SurveySectionId = 'usage' | 'learning' | 'responses' | 'feedback';

export type SurveyInputKind = 'scale' | 'choice' | 'multiChoice' | 'open' | 'matrix';

export interface SurveyQuestion {
  id: string;
  number: number;
  section: SurveySectionId;
  prompt: string;
  kind: SurveyInputKind;
  options?: readonly string[];
  exclusiveOptions?: readonly string[];
  otherOption?: string;
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  features?: readonly string[];
  placeholder?: string;
  rows?: number;
  showNumber?: boolean;
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
  { id: 'usage', title: 'Your use of the Learning Companion', description: 'Your course and exam-revision use.' },
  { id: 'learning', title: 'Learning impact', description: 'How the Learning Companion supported your learning.' },
  { id: 'responses', title: 'AI response quality', description: 'Your experience with the AI-generated responses.' },
  { id: 'feedback', title: 'Feedback and improvements', description: 'What works well and what needs improvement.' },
];

const OTHER = 'Other (please specify)';

export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = [
  {
    id: 'course-code',
    number: 1,
    section: 'usage',
    prompt: 'Which course are you using the Learning Companion for?',
    kind: 'open',
    placeholder: 'Course code',
    rows: 1,
  },
  {
    id: 'usage-frequency',
    number: 2,
    section: 'usage',
    prompt: 'How frequently have you used the Learning Companion for this course?',
    kind: 'choice',
    options: ['Only once', 'A few times', 'Many times', 'Regularly throughout my revision'],
  },
  {
    id: 'revision-uses',
    number: 3,
    section: 'usage',
    prompt: 'What have you used the Learning Companion for during your exam revision?',
    kind: 'multiChoice',
    options: [
      'Clarify concepts that I do not understand',
      'Find relevant information in lecture materials',
      'Check if my understanding on certain concept is correct',
      'Summarise key concepts or topics for revision',
      'Ask questions about practice or past-year exam questions',
      OTHER,
    ],
    otherOption: OTHER,
  },
  {
    id: 'understanding',
    number: 4,
    section: 'learning',
    prompt: 'To what extent do you agree with the following statement? “Using the Learning Companion has helped me better understand the course content during my study.”',
    kind: 'choice',
    options: ['Strongly agree', 'Agree', 'Neutral', 'Disagree', 'Strongly disagree'],
  },
  {
    id: 'learning-benefits',
    number: 5,
    section: 'learning',
    prompt: 'In what ways has the Learning Companion helped with your learning?',
    kind: 'multiChoice',
    options: [
      'Better understand difficult concepts',
      'Save time finding information',
      'Study independently at my own pace',
      'Feel more confident about my understanding',
      'I have not experienced any clear benefit',
      OTHER,
    ],
    exclusiveOptions: ['I have not experienced any clear benefit'],
    otherOption: OTHER,
  },
  {
    id: 'response-quality',
    number: 6,
    section: 'responses',
    prompt: 'How would you rate the following aspects of the AI-generated responses?',
    kind: 'matrix',
    min: 1,
    max: 5,
    minLabel: 'Very poor',
    maxLabel: 'Excellent',
    features: [
      'Relevance – answers address my questions',
      'Accuracy – answers are correct and consistent with course materials',
      'Clarity – explanations are easy to understand',
      'Citations – references help me verify the answers',
    ],
  },
  {
    id: 'problems',
    number: 7,
    section: 'responses',
    prompt: 'What problems have you encountered when using the Learning Companion?',
    kind: 'multiChoice',
    options: [
      'I have not encountered significant issues',
      'Incorrect or misleading answers',
      'Answers that are unclear or insufficiently explained',
      'Answers that do not address my questions',
      'Missing, unclear or incorrect citations',
      'Slow response time',
      'Login or access difficulties',
      OTHER,
    ],
    exclusiveOptions: ['I have not encountered significant issues'],
    otherOption: OTHER,
  },
  {
    id: 'chatgpt-comparison',
    number: 8,
    section: 'responses',
    prompt: 'Compared with general-purpose AI tools such as ChatGPT, how useful is the Learning Companion for revising this course?',
    kind: 'choice',
    options: ['Much more useful', 'Somewhat more useful', 'About the same', 'Less useful', 'I have not used other AI tools for this course'],
  },
  {
    id: 'likes',
    number: 9,
    section: 'feedback',
    prompt: 'What do you like most about the Learning Companion?',
    kind: 'multiChoice',
    options: [
      'Answers based on course materials',
      'Links to relevant lecture recording segments',
      'Clear and accurate explanations of difficult concepts',
      'Available whenever I need help',
      OTHER,
    ],
    otherOption: OTHER,
  },
  {
    id: 'new-features',
    number: 10,
    section: 'feedback',
    prompt: 'Which new features would you find most useful?',
    kind: 'multiChoice',
    options: [
      'Automatically generated practice questions or quizzes',
      'Feedback and explanations based on my answers to the quizzes',
      'Tracking my revision progress and weak topics',
      'Automatic summaries or revision notes',
      'Improved mobile experience',
      OTHER,
    ],
    otherOption: OTHER,
  },
  {
    id: 'improvements',
    number: 11,
    section: 'feedback',
    prompt: 'Which aspects of the Learning Companion do you think need improvement?',
    kind: 'multiChoice',
    options: [
      'No major improvements needed',
      'Accuracy and reliability of answers',
      'Clarity and depth of explanations',
      'Accuracy of citations',
      'Response speed',
      'User interface and ease of navigation',
      'Login and access process',
      'Mobile usability',
      'Other',
    ],
    exclusiveOptions: ['No major improvements needed'],
    otherOption: 'Other',
  },
  {
    id: 'satisfaction',
    number: 12,
    section: 'feedback',
    prompt: 'Overall, how satisfied are you with the Learning Companion?',
    kind: 'choice',
    options: ['1 – Very dissatisfied', '2 – Dissatisfied', '3 – Neutral', '4 – Satisfied', '5 – Very satisfied'],
  },
  {
    id: 'additional-comments',
    number: 12,
    section: 'feedback',
    prompt: 'Any additional comments? (Optional)',
    kind: 'open',
    rows: 4,
    showNumber: false,
  },
];

export function matrixAnswerKey(questionId: string, feature: string): string {
  return `${questionId}:${feature}`;
}

function selectedOptions(value: string | undefined): string[] {
  return value?.split('\n').filter(Boolean) ?? [];
}

function questionLabel(question: SurveyQuestion): string {
  return question.showNumber === false ? question.prompt : `${question.number}. ${question.prompt}`;
}

export function buildSurveyAnswers(values: Record<string, string>): SurveyAnswerPayload[] {
  const answers: SurveyAnswerPayload[] = [];

  for (const question of SURVEY_QUESTIONS) {
    if (question.kind === 'matrix') {
      for (const feature of question.features ?? []) {
        const answer = values[matrixAnswerKey(question.id, feature)]?.trim();
        if (answer) answers.push({ question: `${questionLabel(question)} — ${feature}`, answer });
      }
      continue;
    }

    if (question.kind === 'multiChoice') {
      const options = selectedOptions(values[question.id]);
      if (options.length) {
        const other = values[`${question.id}:other`]?.trim();
        const answer = options.map((option) => option === question.otherOption && other ? `${option}: ${other}` : option).join('; ');
        answers.push({ question: questionLabel(question), answer });
      }
      continue;
    }

    const answer = values[question.id]?.trim();
    if (answer) answers.push({ question: questionLabel(question), answer });
  }

  return answers;
}
