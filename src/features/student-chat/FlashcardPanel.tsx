import { ChevronLeft, ChevronRight, Layers, Loader2, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { Flashcard, Message } from './types';

interface FlashcardPanelProps {
  show: boolean;
  flashcards: Flashcard[];
  sourceMessage: Message | null;
  isGenerating: boolean;
  onClose: () => void;
}

export function FlashcardPanel({
  show,
  flashcards,
  sourceMessage: _sourceMessage,
  isGenerating,
  onClose,
}: FlashcardPanelProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Reset card state when flashcards change
  const cardKey = flashcards.map((f) => f.question).join('|');

  const handlePrev = () => {
    setFlipped(false);
    setCurrentIndex((i) => Math.max(0, i - 1));
  };

  const handleNext = () => {
    setFlipped(false);
    setCurrentIndex((i) => Math.min(flashcards.length - 1, i + 1));
  };

  const handleFlip = () => setFlipped((f) => !f);

  const handleRestart = () => {
    setCurrentIndex(0);
    setFlipped(false);
  };

  if (!show) return null;

  const card = flashcards[currentIndex];

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Flashcards</span>
          {flashcards.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {flashcards.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        {isGenerating ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Generating flashcards…</p>
          </div>
        ) : flashcards.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No flashcards generated.</p>
        ) : (
          <>
            {/* Progress */}
            <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
              <span>
                {currentIndex + 1} / {flashcards.length}
              </span>
              <button
                onClick={handleRestart}
                className="flex items-center gap-1 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                Restart
              </button>
            </div>

            {/* Progress bar */}
            <div className="w-full overflow-hidden rounded-full bg-muted" style={{ height: 4 }}>
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / flashcards.length) * 100}%` }}
              />
            </div>

            {/* Card */}
            <div
              key={`${cardKey}-${currentIndex}`}
              onClick={handleFlip}
              className={cn(
                'relative flex min-h-[200px] w-full cursor-pointer select-none flex-col items-center justify-center rounded-xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md',
                flipped && 'border-primary/30 bg-primary/5'
              )}
            >
              <span className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {flipped ? 'Answer' : 'Question'}
              </span>
              <p className="text-sm leading-relaxed">
                {flipped ? card.answer : card.question}
              </p>
              <span className="mt-4 text-[10px] text-muted-foreground/60">
                {flipped ? 'Click to see question' : 'Click to reveal answer'}
              </span>
            </div>

            {/* Navigation */}
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                disabled={currentIndex === 0}
                className="flex-1"
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNext}
                disabled={currentIndex === flashcards.length - 1}
                className="flex-1"
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
