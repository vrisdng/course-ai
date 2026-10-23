import "@testing-library/jest-dom";

// Node-environment suites (the Vercel functions under api/) have no window.
if (typeof window !== "undefined") {
  // Node 26 exposes a localStorage global that needs --localstorage-file, which
  // shadows jsdom's implementation. Provide an in-memory fallback when jsdom's
  // storage is unavailable so persistence call sites behave like the browser.
  try {
    window.localStorage.getItem("__probe__");
  } catch {
    const store = new Map<string, string>();
    const memoryStorage: Storage = {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (key) => store.get(key) ?? null,
      key: (index) => Array.from(store.keys())[index] ?? null,
      removeItem: (key) => { store.delete(key); },
      setItem: (key, value) => { store.set(key, String(value)); },
    };
    try {
      Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true });
      Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });
    } catch {
      // Both globals are read-only in some environments; tests can still guard.
    }
  }

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // Radix popovers/menus measure their anchors; jsdom has no ResizeObserver.
  if (typeof window.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
}
