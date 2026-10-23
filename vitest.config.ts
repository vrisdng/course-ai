import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    env: {
      VITE_SUPABASE_URL: "http://localhost:9999",
      VITE_SUPABASE_PUBLISHABLE_KEY: "dummy-publishable-key",
    },
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "supabase/functions/**/*.{test,spec}.ts", "api/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}", "supabase/functions/_shared/**/*.ts"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        "src/integrations/supabase/types.ts",
        "src/components/ui/**",
        "supabase/functions/_shared/**/*.test.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Edge functions import these from esm.sh; tests load the same pinned
      // versions from node_modules so _shared/llm.ts runs the real SDK.
      { find: /^https:\/\/esm\.sh\/ai@4\.3\.19(\?.*)?$/, replacement: "ai" },
      { find: /^https:\/\/esm\.sh\/@ai-sdk\/openai@1\.3\.24(\?.*)?$/, replacement: "@ai-sdk/openai" },
      { find: /^https:\/\/esm\.sh\/zod@3\.23\.8(\?.*)?$/, replacement: "zod" },
    ],
  },
});
