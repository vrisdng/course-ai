// Display names for question categories: the Decisions API buckets
// (_shared/questionLabels.ts) and the rule-based ones they extend.
const CATEGORY_LABELS: Record<string, string> = {
  definition_concept: 'Concept or definition',
  how_to_process: 'How to do something',
  calculation: 'Calculation or proof',
  comparison: 'Comparison',
  troubleshooting: 'Troubleshooting',
  factual_lookup: 'Fact lookup',
  course_logistics: 'Course logistics',
  other: 'Other or chat',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
