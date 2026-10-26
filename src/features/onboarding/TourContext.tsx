import { HelpCircle } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

type StartTour = () => void;

interface TourContextValue {
  start: StartTour | null;
  register: (start: StartTour) => () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

/** Lets a page offer its tour to the header's help button. */
export function TourProvider({ children }: { children: ReactNode }) {
  const [start, setStart] = useState<StartTour | null>(null);

  const [value] = useState<Omit<TourContextValue, 'start'>>(() => ({
    register: (next: StartTour) => {
      setStart(() => next);
      return () => setStart((current) => (current === next ? null : current));
    },
  }));

  return <TourContext.Provider value={{ ...value, start }}>{children}</TourContext.Provider>;
}

/** Registers the current page's tour while the page is mounted. */
export function useRegisterTour(start: StartTour): void {
  const context = useContext(TourContext);
  const register = context?.register;
  // Keep one stable callback registered, always calling the latest `start`.
  const latestStart = useRef(start);
  latestStart.current = start;

  useEffect(() => {
    if (!register) return;
    return register(() => latestStart.current());
  }, [register]);
}

/** Header button that replays the current page's tour. Renders nothing if the page has none. */
export function TourHelpButton() {
  const start = useContext(TourContext)?.start;
  if (!start) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground hover:text-foreground"
      aria-label="Show tour"
      title="Show tour"
      data-tour="tour-help"
      onClick={start}
    >
      <HelpCircle className="h-5 w-5" />
    </Button>
  );
}
