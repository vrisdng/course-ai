import { useCallback, useEffect, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  children: string;
  className?: string;
  node?: { properties?: { className?: unknown } | null };
}

function languageFromClassName(className?: string): string {
  if (!className) return '';
  const match = /^language-(\w+)/.exec(className);
  return match ? match[1].toLowerCase() : '';
}

function isBlockClassName(className?: string): boolean {
  return typeof className === 'string' && /^language-/.test(className);
}

function isBlockCode(node?: CodeBlockProps['node']): boolean {
  const classes = node?.properties?.className;
  if (!Array.isArray(classes)) {
    return false;
  }
  return classes.some((entry) => (typeof entry === 'string' ? entry : entry?.value)?.startsWith('language-'));
}

function highlightCode(code: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language: language }).value;
    } catch {
      /* fall through to auto */
    }
  }
  try {
    return hljs.highlightAuto(code).value;
  } catch {
    return code;
  }
}

export function CodeBlock({ children, className, node }: CodeBlockProps) {
  const isBlock = isBlockClassName(className) || isBlockCode(node);
  const language = languageFromClassName(className);
  const code = (children ?? '').replace(/\n$/, '');

  const [highlighted, setHighlighted] = useState('');
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setHighlighted(highlightCode(code, language));
  }, [code, language]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [code]);

  if (!isBlock) {
    return (
      <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="overflow-x-auto p-3">
        <code className="hljs">
          <span
            ref={codeRef}
            className="font-mono text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </code>
      </pre>
    </div>
  );
}
