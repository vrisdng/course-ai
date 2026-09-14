// Formatting guidance appended to the FORMATTING paragraph of every rag-chat
// system prompt. Shared so both the RAG and no-RAG prompts stay in sync and the
// guidance is unit-testable in one place.
export const FORMATTING_MATH_GUIDANCE =
  'Present all math and equations with LaTeX: block math delimited by double dollar signs ($$...$$) and inline math by single dollar signs ($...$).';

export const FORMATTING_CODE_GUIDANCE =
  'Present all source code in fenced code blocks, opened with three backticks and a language label such as python.';

export const FORMATTING_FORMATTING_EXTRA = `${FORMATTING_MATH_GUIDANCE} ${FORMATTING_CODE_GUIDANCE}`;
