import katex from 'katex';

// Renders LaTeX into KaTeX HTML so the markdown renderer can display equations.
// Supports both dollar-sign delimiters ($...$, $$...$$) and backslash-bracket
// delimiters (\(...\), \[...\]) so equations render regardless of which style the
// model emits. Code (fenced or inline) is left untouched so LaTeX-looking text
// inside code blocks is never treated as math. Falls back to the original text
// if a segment cannot be rendered.
const MATH_PATTERN =
  /(```[\s\S]*?```)|(`[^`\n]+`)|(\$\$[\s\S]*?\$\$)|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(\$[^$\n\s][^$\n]*?\$)/g;

function renderSegment(tex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false });
  } catch {
    return null;
  }
}

// Strips the delimiter on each side of a matched math segment. Bracket and double
// dollar forms use two-character delimiters; the single-dollar form uses one.
function extractTex(match: string): string {
  if (match.startsWith('$$') || match.startsWith('\\[') || match.startsWith('\\(')) {
    return match.slice(2, -2).trim();
  }
  return match.slice(1, -1).trim();
}

export function processMath(content: string): string {
  return content.replace(
    MATH_PATTERN,
    (match) => {
      // Code starts with a backtick; never treat it as math.
      if (match.startsWith('`')) {
        return match;
      }
      const display = match.startsWith('$$') || match.startsWith('\\[');
      return renderSegment(extractTex(match), display) ?? match;
    },
  );
}
