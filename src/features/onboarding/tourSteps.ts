import type { DriveStep, Side } from 'driver.js';

/** One stop on a tour. `targets` are `data-tour` ids; the first one on screen is highlighted. */
export interface TourStepDefinition {
  id: string;
  title: string;
  description: string;
  /** Leave out for a centred popover with no highlight (e.g. a welcome step). */
  targets?: string[];
  side?: Side;
}

export interface ResolveTourStepsOptions {
  root?: ParentNode;
  isVisible?: (element: Element) => boolean;
}

export function tourTarget(id: string): string {
  return `[data-tour="${id}"]`;
}

function hasLayoutBox(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Turns step definitions into driver.js steps for what is on screen right now.
 * A step whose targets are all hidden (e.g. the desktop sidebar on a phone) is dropped,
 * so one tour definition works across layouts.
 */
export function resolveTourSteps(
  definitions: TourStepDefinition[],
  { root = document, isVisible = hasLayoutBox }: ResolveTourStepsOptions = {},
): DriveStep[] {
  const steps: DriveStep[] = [];

  for (const definition of definitions) {
    const popover = {
      title: definition.title,
      description: definition.description,
      ...(definition.side ? { side: definition.side } : {}),
    };

    if (!definition.targets) {
      steps.push({ popover });
      continue;
    }

    const element = definition.targets
      .flatMap((id) => Array.from(root.querySelectorAll(tourTarget(id))))
      .find(isVisible);
    if (element) steps.push({ element, popover });
  }

  return steps;
}

export const STUDENT_CHAT_TOUR: TourStepDefinition[] = [
  {
    id: 'welcome',
    title: 'Welcome to CEEChat',
    description:
      'CEEChat answers questions about your course materials and links each answer to the slide, page or video moment it came from. Here is a quick look around.',
  },
  {
    id: 'course',
    title: 'Pick your course',
    description:
      'Choose the course you want to ask about. Contact your lecturer if a course is missing.',
    targets: ['course-picker', 'mobile-nav'],
    side: 'right',
  },
  {
    id: 'new-chat',
    title: 'Your conversations',
    description:
      'Start a new chat here. Past chats are saved below, and you can search them.',
    targets: ['new-chat'],
    side: 'right',
  },
  {
    id: 'documents',
    title: 'Choose which materials to search',
    description:
      'CEEChat searches every material in the course by default. To focus on certain lectures or tutorials, pick them here.',
    targets: ['document-scope'],
    side: 'top',
  },
  {
    id: 'composer',
    title: 'Ask a question',
    description: 'Type your question and press Enter to send. Shift + Enter starts a new line.',
    targets: ['composer'],
    side: 'top',
  },
  {
    id: 'model',
    title: 'Pick a model',
    description: 'If your course offers more than one model, switch between quicker answers and more thorough ones here.',
    targets: ['model-picker'],
    side: 'top',
  },
  {
    id: 'sources',
    title: 'Check the sources',
    description:
      'Answers come with numbered citations. Click one to open the page or video clip it came from in this panel.',
    targets: ['sources-toggle'],
    side: 'left',
  },
  {
    id: 'replay',
    title: 'See this tour again',
    description: 'Click here whenever you want to replay this tour.',
    targets: ['tour-help'],
    side: 'bottom',
  },
];
