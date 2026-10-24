// Common terms in students' questions, from get_course_question_terms.

export interface QuestionTerm {
  // Stemmed form, e.g. "hash tabl".
  key: string;
  // The wording students used most, e.g. "hash table".
  term: string;
  wordCount: number;
  questionCount: number;
  studentCount: number;
}

// A word is shown on its own only when it isn't mostly part of a phrase
// already listed: "cortado" is dropped when "cortado company" covers at
// least this share of its questions.
const COVERED_SHARE = 0.75;

export const TERMS_SHOWN = 15;

export function pickTopTerms(terms: ReadonlyArray<QuestionTerm>, limit = TERMS_SHOWN): QuestionTerm[] {
  const phrases = terms.filter((term) => term.wordCount > 1);
  const kept = terms.filter((term) => {
    if (term.wordCount > 1) return true;
    return !phrases.some((phrase) =>
      phrase.key.split(' ').includes(term.key) && phrase.questionCount >= COVERED_SHARE * term.questionCount);
  });
  return kept
    .sort((a, b) =>
      b.questionCount - a.questionCount
      || b.wordCount - a.wordCount
      || a.term.localeCompare(b.term))
    .slice(0, limit);
}
