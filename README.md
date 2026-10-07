# Getting Started

For the next developer picking this up. For *what* the app does, see [GET_STARTED.md](GET_STARTED.md). For *what's broken/risky*, see [HANDOFF.md](HANDOFF.md) — read that before touching auth, `AdminDashboard.tsx`, or `rag-chat`.

## 1. Prerequisites

- Node.js (any recent LTS — the repo has no `.nvmrc`/engines pin, matching the loose Lovable-scaffold origins of this project)
- npm (use npm — the repo tracks `package-lock.json`; `bun.lockb` was removed)
- A Supabase account with access to project `ksthojmoifnunsatmday` (see `supabase/config.toml`), or your own Supabase project if you're standing up a fresh environment
- API keys for: Gemini, OpenAI, AssemblyAI, Resend (ask whoever owns the project for these, or provision your own — see [Environment variables](#3-environment-variables))

## 2. Clone and install

```sh
git clone <this-repo-url>
cd course-companion-ai
npm i
```

## 3. Environment variables

⚠️ **Before anything else**: this repo has `.env` committed to git history (see [HANDOFF.md](HANDOFF.md) §0). Don't reuse whatever keys are already in a checked-out `.env` for anything beyond local dev against a throwaway/dev Supabase project — they should be rotated. If you're setting up fresh, request new keys.

Create a `.env` at the project root (no `.env.example` exists yet — consider adding one) with:

```sh
# Supabase — frontend (Vite requires the VITE_ prefix to be exposed to the browser)
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=

# Supabase — CLI/tooling (for running `supabase` CLI commands, migrations, functions deploy)
SUPABASE_ACCESS_TOKEN=

# AI providers — used by edge functions (set these in Supabase, see step 5, not just locally)
GEMINI_API_KEY=
OPENAI_API_KEY=
ASSEMBLY_API_KEY=

# Transactional email — used by the course-invite email flow
RESEND_API_KEY=

# PDF page renderer (api/render-pdf-pages.ts on Vercel) — set on BOTH Supabase
# and Vercel (see steps 5 and 6). Never give these a VITE_ prefix.
RENDER_SERVICE_URL=      # https://<vercel-domain>/api/render-pdf-pages (Supabase only)
RENDER_SERVICE_SECRET=   # random shared secret, e.g. `openssl rand -hex 32`
```

The `VITE_*` vars are read by `src/integrations/supabase/client.ts` and get baked into the client bundle at build time. The non-`VITE_*` vars are consumed by Supabase Edge Functions, not the frontend build — see step 5.

## 4. Run the frontend locally

```sh
npm run dev
```

Starts Vite on `http://localhost:8080` (see `vite.config.ts` — port 8080, not the Vite default 5173). Hot-reload works normally.

The frontend alone won't do much useful without a working Supabase backend behind it (auth, chat, materials all hit Supabase) — see step 5.

## 5. Supabase backend

This project uses Supabase for Postgres (with `pgvector`), auth, storage, and Edge Functions (Deno). You need the [Supabase CLI](https://supabase.com/docs/guides/cli) installed.

```sh
npm install -g supabase   # or brew install supabase/tap/supabase
supabase login            # uses SUPABASE_ACCESS_TOKEN or interactive login
supabase link --project-ref ksthojmoifnunsatmday
```

**Migrations** — 30 files in `supabase/migrations/`, applied in filename (timestamp) order:

```sh
supabase db push          # applies pending migrations to the linked remote project
```

Read the migration list in [HANDOFF.md](HANDOFF.md) before writing a new one — several tables/columns were added then reverted (conversation limits, `lecturer` role, `organizations`), so grep the existing migrations for a concept before assuming it doesn't exist.

**Edge functions** — 13 functions in `supabase/functions/` (`rag-chat`, `ingest-material`, `parse-document`, `transcribe-video`, `upload-video`, `process-material-job`, `reap-stale-jobs`, `generate-flashcards`, `analytics-chat`, `manage-course-invites`, `check-course-invite`, `redeem-course-invite`, `generate-course-code`). Every one of them has `verify_jwt = false` in `supabase/config.toml`, meaning they do their own auth checks — see [HANDOFF.md](HANDOFF.md) §3 before assuming that's handled consistently.

Deploy a function:

```sh
supabase functions deploy rag-chat
# or all at once
supabase functions deploy
```

Each function needs its own secrets set on the Supabase project (these are **separate** from your local `.env` — Edge Functions run on Supabase's infra, not your machine):

```sh
supabase secrets set GEMINI_API_KEY=... OPENAI_API_KEY=... ASSEMBLY_API_KEY=... RESEND_API_KEY=...
supabase secrets set RENDER_SERVICE_URL=https://<production-domain>/api/render-pdf-pages RENDER_SERVICE_SECRET=...
```

Without the two `RENDER_SERVICE_*` secrets, ingestion skips PDF page images and citations fall back to rendering the PDF in the browser.

Run a function locally against your local `.env` for faster iteration:

```sh
supabase functions serve rag-chat --env-file .env
```

**Reminder**: `reap-stale-jobs` is meant to run on a schedule (stale-job cleanup, 5-minute staleness threshold, 5-attempt retry cap — see [GET_STARTED.md](GET_STARTED.md)'s dynamic-behavior table). No `pg_cron` schedule was found checked into migrations — confirm whether this is wired up via the Supabase dashboard's cron scheduler before assuming stuck jobs self-heal in whatever environment you're working in.

## 6. Deploying the frontend (Vercel)

`vercel.json` holds the SPA fallback rewrite (everything except `/api/*` → `/index.html`) and the config for the one Vercel Function, `api/render-pdf-pages.ts`. That function renders PDF pages to images during ingestion; `process-material-job` calls it, and nothing in the browser does (see [HANDOFF.md](HANDOFF.md), "Page images + citation highlights"). Build settings and env vars live in the Vercel project dashboard. To deploy:

1. Import the repo into Vercel (or `vercel link` if a project already exists — check with whoever owns deployment before creating a duplicate project).
2. Framework preset: Vite. Build command: `npm run build` (or leave as Vercel's auto-detected default, which matches). Output directory: `dist`.
3. Set the three `VITE_*` env vars (step 3) in Vercel's project settings, plus `RENDER_SERVICE_SECRET` (same value as the Supabase secret) for the renderer function. The renderer also reads `VITE_SUPABASE_URL` (or `SUPABASE_URL`) at runtime to restrict which storage URLs it will fetch from and upload to. The AI/email provider keys belong on Supabase (step 5), not Vercel, since those run in Edge Functions.
4. Push to the branch Vercel is watching, or run `vercel --prod` for a manual deploy.

There's no CI config in this repo (no `.github/workflows`) — deploys are push-triggered by Vercel directly and Supabase changes (migrations/functions) are pushed manually via the CLI. If you're setting up a new environment, that manual-push gap is worth knowing about before you assume "merging to main" does anything to the backend.

## 7. Day-to-day scripts

```sh
npm run dev         # vite dev server, :8080
npm run build        # production build → dist/
npm run build:dev    # dev-mode build (unminified, for debugging a build issue)
npm run preview      # serve the built dist/ locally
npm run lint         # eslint .
npm run test         # vitest run (one-shot)
npm run test:watch   # vitest watch mode
```

Test coverage is improving — `materialUpload.test.ts` and `documentScope.test.ts` pass, plus rag-chat's pure-logic and SSE tests. Don't expect `npm run test` to catch regressions in `AdminDashboard.tsx`, `useStudentChat.ts`, or any edge function; there is no coverage there yet. See [HANDOFF.md](HANDOFF.md) §4.

## 8. Where to start reading code

- `src/App.tsx` — routes and provider stack, the fastest way to see what pages exist.
- `src/contexts/AuthContext.tsx` — session/role state, used everywhere.
- `src/features/student-chat/useStudentChat.ts` + `supabase/functions/rag-chat/index.ts` — the core product feature (RAG chat); large and untested, read before editing.
- `src/pages/AdminDashboard.tsx` — the admin surface; also large (2459 lines) — see [HANDOFF.md](HANDOFF.md) §1 before adding to it, there's a half-finished decomposition already sitting in `src/components/lecturer/`.
- `supabase/migrations/` — read in filename order if you need to understand how the schema got to its current shape; several migrations reverse earlier ones.

## 9. Before you commit

1. Rotate any secrets you were handed if you haven't confirmed they're already rotated post-repo-exposure (see step 3 warning).
2. Run `npm run lint` and `npm run test`.
3. If you touched `AdminDashboard.tsx`, `useStudentChat.ts`, or any edge function, there's no test net — manually exercise the flow (sign in as both a student and an admin if the change touches shared code).
4. Check [HANDOFF.md](HANDOFF.md) for anything relevant to the area you changed before opening a PR — it tracks known debt so you don't accidentally "fix" something that was a deliberate tradeoff, or miss a related landmine.
