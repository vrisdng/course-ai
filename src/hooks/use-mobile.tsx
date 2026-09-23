import { useEffect, useState } from 'react';

/** Viewports narrower than this are treated as phones (matches Tailwind's `md` breakpoint). */
export const MOBILE_BREAKPOINT = 768;

const query = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

/**
 * True when the viewport is narrower than the `md` breakpoint.
 * Use only for behaviour that CSS alone cannot express (inline widths, portals);
 * prefer responsive Tailwind classes for layout.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => (
    typeof window === 'undefined' ? false : window.innerWidth < MOBILE_BREAKPOINT
  ));

  useEffect(() => {
    const mediaQuery = query();
    const update = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mediaQuery.addEventListener('change', update);
    update();
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isMobile;
}
