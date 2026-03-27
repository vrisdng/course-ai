import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { getCitationKey } from './citations';
import { formatCitationLocator } from './time';
import type { Citation, Message } from './types';

interface SourcesPanelProps {
  showSidePanel: boolean;
  selectedMessage: Message | null;
  highlightedCitationKey: string | null;
  openingCitationKey: string | null;
  onOpenPanel: () => void;
  onClosePanel: () => void;
  onClearHighlight: () => void;
  onOpenCitationSource: (citation: Citation, citationKey: string) => void;
}

export function SourcesPanel({
  showSidePanel,
  selectedMessage,
  highlightedCitationKey,
  openingCitationKey,
  onOpenPanel,
  onClosePanel,
  onClearHighlight,
  onOpenCitationSource,
}: SourcesPanelProps) {
  const citationRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!showSidePanel || !highlightedCitationKey) return;

    const target = citationRefs.current[highlightedCitationKey];
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const timeoutId = window.setTimeout(() => {
      onClearHighlight();
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [highlightedCitationKey, onClearHighlight, showSidePanel]);

  return (
    <>
      <aside
        className={cn(
          'border-l border-border bg-muted/30 transition-all duration-300',
          showSidePanel ? 'w-80' : 'w-0'
        )}
      >
        {showSidePanel && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="font-semibold text-foreground">Sources</h3>
              <Button variant="ghost" size="icon" onClick={onClosePanel}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1 p-4">
              {selectedMessage?.citations && selectedMessage.citations.length > 0 ? (
                <div className="space-y-2">
                  {selectedMessage.citations.map((citation, index) => {
                    const citationKey = getCitationKey(selectedMessage.id, index + 1);
                    const isHighlighted = highlightedCitationKey === citationKey;
                    const isOpening = openingCitationKey === citationKey;

                    return (
                      <div
                        key={`${selectedMessage.id}-${citation.id}-${index + 1}`}
                        ref={(element) => {
                          citationRefs.current[citationKey] = element;
                        }}
                        className="px-1 py-1"
                      >
                        <div
                          className={cn(
                            'citation-card transition-all duration-300',
                            isHighlighted && 'bg-primary/5 ring-2 ring-primary ring-offset-2'
                          )}
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                                {index + 1}
                              </span>
                              <span className="text-xs font-medium text-foreground">{citation.documentName}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {Math.round(citation.relevanceScore * 100)}% match
                            </span>
                          </div>

                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <FileText className="h-3 w-3" />
                            <span>
                              {formatCitationLocator({
                                pageNumber: citation.pageNumber,
                                startMs: citation.startMs,
                                endMs: citation.endMs,
                              })}
                            </span>
                          </div>

                          <p
                            className={cn(
                              'rounded bg-yellow-100/70 px-1 py-0.5 text-sm text-foreground/80 line-clamp-4',
                              isHighlighted && 'rounded bg-yellow-200/70 px-1 py-0.5'
                            )}
                          >
                            "{citation.excerpt}"
                          </p>

                          <button
                            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => onOpenCitationSource(citation, citationKey)}
                            disabled={isOpening}
                          >
                            {isOpening ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <ExternalLink className="h-3 w-3" />
                            )}
                            {isOpening
                              ? 'Opening source...'
                              : citation.documentType === 'video'
                                ? 'View transcript'
                                : 'View original file'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    Click on a message with sources to see citations here
                  </p>
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </aside>

      {!showSidePanel && (
        <button
          onClick={onOpenPanel}
          className="fixed right-0 top-1/2 -translate-y-1/2 rounded-l-lg border border-r-0 border-border bg-background p-2 shadow-md"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
    </>
  );
}
