import { describe, expect, it } from 'vitest';

import { resolveTourSteps, STUDENT_CHAT_TOUR, tourTarget, type TourStepDefinition } from './tourSteps';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const alwaysVisible = () => true;

describe('tourTarget', () => {
  it('builds a data-tour attribute selector', () => {
    expect(tourTarget('composer')).toBe('[data-tour="composer"]');
  });
});

describe('resolveTourSteps', () => {
  it('keeps steps without targets as centred popovers', () => {
    const defs: TourStepDefinition[] = [{ id: 'welcome', title: 'Hi', description: 'Welcome' }];
    const steps = resolveTourSteps(defs, { root: mount(''), isVisible: alwaysVisible });

    expect(steps).toEqual([{ popover: { title: 'Hi', description: 'Welcome' } }]);
  });

  it('anchors a step to the first target that is visible', () => {
    const root = mount('<button data-tour="a">A</button><button data-tour="b">B</button>');
    const hidden = root.querySelector('[data-tour="a"]');
    const defs: TourStepDefinition[] = [
      { id: 'pick', title: 'Pick', description: 'd', targets: ['a', 'b'], side: 'right' },
    ];

    const steps = resolveTourSteps(defs, { root, isVisible: (el) => el !== hidden });

    expect(steps).toHaveLength(1);
    expect(steps[0].element).toBe(root.querySelector('[data-tour="b"]'));
    expect(steps[0].popover).toEqual({ title: 'Pick', description: 'd', side: 'right' });
  });

  it('drops a step when none of its targets are on screen', () => {
    const root = mount('<div data-tour="present"></div>');
    const defs: TourStepDefinition[] = [
      { id: 'gone', title: 'Gone', description: 'd', targets: ['missing'] },
      { id: 'here', title: 'Here', description: 'd', targets: ['present'] },
    ];

    const steps = resolveTourSteps(defs, { root, isVisible: alwaysVisible });

    expect(steps.map((step) => step.popover?.title)).toEqual(['Here']);
  });

  it('treats elements with no layout box as hidden by default', () => {
    const root = mount('<div data-tour="x"></div>');
    const defs: TourStepDefinition[] = [{ id: 'x', title: 'X', description: 'd', targets: ['x'] }];

    // jsdom has no layout, so getClientRects() is empty.
    expect(resolveTourSteps(defs, { root })).toEqual([]);
  });
});

describe('STUDENT_CHAT_TOUR', () => {
  it('opens with a welcome and ends by pointing at the replay button', () => {
    expect(STUDENT_CHAT_TOUR[0].targets).toBeUndefined();
    expect(STUDENT_CHAT_TOUR.at(-1)?.targets).toEqual(['tour-help']);
  });

  it('has unique step ids', () => {
    const ids = STUDENT_CHAT_TOUR.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
