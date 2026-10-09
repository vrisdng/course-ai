// Maths is rendered after the markdown is parsed (remark-math + rehype-katex in
// RichMarkdown), so formulas never interfere with markdown structure such as
// table rows. remark-math only understands dollar delimiters, so the model's
// \(...\) and \[...\] forms are converted first. Code (fenced or inline) is
// left untouched so LaTeX-looking text inside code stays literal.
const DELIMITER_PATTERN = /(```[\s\S]*?```)|(`[^`\n]+`)|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;

export function normalizeMathDelimiters(content: string): string {
  return content.replace(DELIMITER_PATTERN, (match, fence, inlineCode, display, inline) => {
    if (fence || inlineCode) return match;
    // $$ must sit on its own lines for remark-math to treat it as a display block.
    if (display !== undefined) return `\n$$\n${display.trim()}\n$$\n`;
    return `$${inline.trim()}$`;
  });
}
