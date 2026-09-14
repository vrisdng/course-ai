import { useCallback, useEffect, useState } from 'react';

/**
 * Boolean state persisted to localStorage under `key`, expressed as
 * `collapsed` (default `true`), so a panel/sidebar can start collapsed and keep
 * its last open/closed state across reloads.
 */
export function usePersistedCollapse(
  key: string,
  defaultValue = true,
): [collapsed: boolean, setCollapsed: (value: boolean) => void, toggle: () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultValue : stored === 'true';
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, collapsed ? 'true' : 'false');
    } catch {
      // Storage may be unavailable (private mode, quota); persistence is best-effort.
    }
  }, [key, collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((previous) => !previous);
  }, []);

  return [collapsed, setCollapsed, toggle];
}
