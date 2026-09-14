import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useState } from 'react';

import {
  groupAdjacentCitations,
  isWebcastCitation,
  markdownWithCitationLinks,
  normalizeHeadings,
} from './citations';
import { CodeBlock } from './CodeBlock';
import { processMath } from './processMath';
import { resolveSignedMediaUrl } from './signedMedia';
import type { Citation } from './types';

interface RichMarkdownProps {
  content: string;
  citations?: Citation[];
  onCitationClick?: (citationNumber: number) => void;
}

interface LightboxImage {
  signedUrl: string;
  alt: string;
}

const UNSAFE_URL_PREFIXES = ['javascript:', 'data:', 'blob:'];

function isSafeImageUrl(src: string | undefined): boolean {
  if (!src) {
    return false;
  }
  const normalized = src.trim().toLowerCase();
  if (UNSAFE_URL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  return /^https?:\/\//.test(normalized) || normalized.startsWith('/');
}

function CitationImage({
  citation,
  alt,
  onOpen,
}: {
  citation: Citation;
  alt: string;
  onOpen: (image: LightboxImage) => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  void resolveSignedMediaUrl(citation.materialId ?? undefined).then((url) => {
    if (url) {
      setSignedUrl(url);
    } else {
      setFailed(true);
    }
  });

  return (
    <button
      type="button"
      onClick={() => {
        if (signedUrl) {
          onOpen({ signedUrl, alt });
        }
      }}
      disabled={!signedUrl}
      className={cn(
        'my-3 w-full overflow-hidden rounded-lg border border-border text-left',
        signedUrl && 'cursor-zoom-in hover:border-primary/40',
      )}
      aria-label={alt || 'Cited image'}
    >
      {signedUrl ? (
        <img
          src={signedUrl}
          alt={alt}
          loading="lazy"
          className="mx-auto max-h-96 w-auto object-contain"
        />
      ) : failed ? (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          Image unavailable
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          Loading image…
        </div>
      )}
    </button>
  );
}

export function RichMarkdown({ content, citations = [], onCitationClick }: RichMarkdownProps) {
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  const citedImageFor = (src: string | undefined): Citation | undefined =>
    src ? citations.find((item) => item.imageUrl && item.imageUrl === src) : undefined;

  return (
    <>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          urlTransform={(url) => (url.startsWith('citation:') ? url : defaultUrlTransform(url))}          components={{
            code: (props) => {
              const { className, children, node } = props as {
                className?: string;
                children?: React.ReactNode;
                node?: { properties?: { className?: unknown } | null };
              };
              return <CodeBlock className={className} node={node}>{children as string}</CodeBlock>;
            },
            table: ({ children }) => (
              <div className="my-3 w-full overflow-x-auto">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="border-b border-border/60 bg-muted/40">{children}</thead>
            ),
            tbody: ({ children }) => (
              <tbody className="divide-y divide-border/40">{children}</tbody>
            ),
            tr: ({ children }) => (
              <tr className="transition-colors hover:bg-muted/20">{children}</tr>
            ),
            th: ({ children }) => (
              <th className="border-r border-border/40 px-3 py-2 text-left text-xs font-semibold text-muted-foreground last:border-r-0">{children}</th>
            ),
            td: ({ children }) => (
              <td className="border-r border-border/40 px-3 py-2 last:border-r-0">{children}</td>
            ),
            img: ({ src, alt }) => {
              const citation = citedImageFor(src);
              if (citation) {
                return <CitationImage citation={citation} alt={alt ?? ''} onOpen={setLightbox} />;
              }
              if (!isSafeImageUrl(src)) {
                return null;
              }
              return (
                <img
                  src={src}
                  alt={alt}
                  loading="lazy"
                  className="my-3 max-h-96 w-auto rounded-lg object-contain"
                />
              );
            },
            a: ({ href, children }) => {
              if (href?.startsWith('citation:')) {
                const key = href.split(':')[1];
                const nums = key.split('+').map(Number);
                const resolvedCitations = nums
                  .map((n) => citations[n - 1])
                  .filter(Boolean) as NonNullable<typeof citations>[number][];

                if (nums.every(Number.isFinite)) {
                  const displayNum = nums.join('·');

                  if (resolvedCitations.length === 0) {
                    return (
                      <span className="mx-0.5 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        [{displayNum}]
                      </span>
                    );
                  }

                  const anyWebcast = resolvedCitations.some(isWebcastCitation);
                  const anyNotes = resolvedCitations.some((c) => !isWebcastCitation(c));
                  const sourceLabel = [
                    anyWebcast ? 'Webcast' : null,
                    anyNotes ? 'Notes' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');

                  return (
                    <button
                      type="button"
                      title={resolvedCitations.map((c) => c.documentName).join(' + ')}
                      className="mx-0.5 inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onCitationClick?.(nums[0]);
                      }}
                    >
                      [{displayNum}] <span className="opacity-70">{sourceLabel}</span>
                    </button>
                  );
                }
              }

              if (!href || href === '#' || href === '') {
                return <span className="font-semibold">{children}</span>;
              }

              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {markdownWithCitationLinks(
            groupAdjacentCitations(
              normalizeHeadings(processMath(content)),
              citations,
            ),
            citations.length,
          )}
        </ReactMarkdown>
      </div>

      <Dialog open={lightbox !== null} onOpenChange={(open) => setLightbox(open ? lightbox : null)}>
        <DialogContent className="max-w-4xl">
          {lightbox && (
            <img
              src={lightbox.signedUrl}
              alt={lightbox.alt}
              className="max-h-[80vh] w-auto mx-auto object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
