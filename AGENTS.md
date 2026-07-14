# AGENTS.md — EduChat

RAG-based course companion: students chat over course materials with cited answers; lecturers/admins upload and manage materials. React + Vite frontend, Supabase (Postgres + `pgvector`, Auth, Storage, Deno Edge Functions) backend.

**Read these first for context this file doesn't repeat:**
- [README.md](README.md) — setup, env vars, deploy, day-to-day scripts.
- [HANDOFF.md](HANDOFF.md) — known debt and landmines. Read before touching auth, `AdminDashboard.tsx`, or `rag-chat`.
- [GET_STARTED.md](GET_STARTED.md) — what the app does and its dynamic behaviors.

## Architecture

**Frontend** (`src/`) — Vite + React 18 + TypeScript, Tailwind + shadcn/ui, React Router, TanStack-free (state via hooks + context). Talks to Supabase via `src/integrations/supabase/client.ts`.
- `src/pages/` — one file per route; routes + provider stack live in `src/App.tsx`.
- `src/features/<feature>/` — feature-scoped UI + hooks + helpers, colocated (e.g. `student-chat/useStudentChat.ts` drives RAG chat; `materials/`, `analytics-chat/`). New feature work goes here, not in `pages/`.
- `src/components/ui/` — shadcn primitives (don't hand-edit unless changing the primitive itself). `src/components/lecturer/`, `auth/`, `layout/` — shared app components.
- `src/contexts/AuthContext.tsx` — session + role state, consumed everywhere.
- `src/lib/` — cross-feature helpers (upload pipeline, utils).
- `src/integrations/supabase/types.ts` — **generated** DB types; regenerate, don't hand-edit.

**Backend** (`supabase/`) — 13 Deno Edge Functions in `supabase/functions/`, 30 SQL migrations in `supabase/migrations/` (applied in filename/timestamp order; several reverse earlier ones — grep before assuming a table/column doesn't exist).
- `supabase/functions/_shared/` — the real backend library: `llm.ts` (OpenAI wrapper — **all** LLM calls route through here), `retrieval.ts`, `citations.ts`, `chunking.ts`, `query.ts`, `history.ts`, `cors.ts`, `sse.ts`, `email.ts`. Reuse these; don't reimplement retrieval/citation/CORS logic per function.
- Core RAG path: `src/features/student-chat/useStudentChat.ts` → `supabase/functions/rag-chat/index.ts` (embeds query with Gemini, retrieves from `pgvector`, reranks, streams a cited answer over SSE via OpenAI).
- Material ingestion path: `upload-video`/`ingest-material` → `parse-document`/`transcribe-video` → `process-material-job` (chunk + embed). `reap-stale-jobs` cleans up stalled jobs (meant to run on a schedule — verify it's wired; see README §5).

## Conventions

- **TypeScript + SWE best practices.** Prefer clarity and small, well-named units over cleverness.
- **Maintainability and modularity first.** Keep code easy to move and change: colocate feature code under `src/features/<feature>/`, factor shared backend logic into `supabase/functions/_shared/`. Look for an existing helper/type/pattern before writing a new one.
- **Explicit types at boundaries.** Declare parameter, return, and payload shapes; never leave an implicit `any`. Model request/response bodies as `interface`s (see the `ChatRequest` pattern in `rag-chat`).
- **One LLM wrapper.** Call OpenAI only through `_shared/llm.ts` so provider/model swaps stay in one place. Model tiers are configured, not hardcoded at call sites.
- **Write tests for code you add or change,** working toward 99% coverage — the repo is far below that today, so add tests rather than assuming they exist.
- **Deploy edge functions after changing them** — see "Safe modification" below.

## Safe modification

1. **Understand the flow before editing.** For RAG or ingestion changes, trace frontend hook → edge function → `_shared/` module end to end. Both `rag-chat` and `useStudentChat.ts` are large and untested — read fully first.
2. **Edge functions do their own auth.** Every function has `verify_jwt = false` in `supabase/config.toml`; the JWT/role check is in the function body. Preserve it when editing, and add it to any new function. See [HANDOFF.md](HANDOFF.md) §3.
3. **`import "@/…"` resolves to `src/`** (Vite alias). Edge functions use Deno URL imports (`https://esm.sh/…`, `https://deno.land/…`) — no npm/`node_modules`; match existing pinned versions.
4. **Schema changes = a new migration** in `supabase/migrations/` (never edit an applied one), then regenerate `src/integrations/supabase/types.ts`. Grep existing migrations first — some concepts were added then reverted.
5. **Deploy after every edge-function change:** `supabase functions deploy <name>` (frontend changes don't need this; they ship via Vercel push). Migrations apply via `supabase db push`.
6. **Verify manually — test coverage is thin.** Only a handful of `*.test.ts` files exist (mostly under `_shared/` and `features/student-chat/`). `npm run test` won't catch regressions in `AdminDashboard.tsx`, `useStudentChat.ts`, or most edge functions. If you touch shared code, exercise the flow as both a student and an admin.
7. **Before committing:** `npm run lint` and `npm run test`, then re-check [HANDOFF.md](HANDOFF.md) for the area you changed so you don't "fix" a deliberate tradeoff.
