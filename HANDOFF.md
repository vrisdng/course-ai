# Handoff: Technical Debt & Known Issues

Living doc for whoever picks this up next. Codebase: React 18 + Vite + TypeScript frontend, Supabase (Postgres + pgvector + Edge Functions) backend. Originated from a Lovable.dev scaffold — several artifacts below are leftovers from that.

## Start here — highest priority

### 0. Secrets are in git history — rotate before anything else
`.env` is tracked and committed (confirmed via `git log --all --full-history -- .env`, present across many commits including the current HEAD). It contains `GEMINI_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, `RESEND_API_KEY`, and the Supabase publishable key. `.gitignore` never excludes `.env` by name, only generic patterns like `*.local`. **Rotate all of these keys and add `.env` to `.gitignore`** before doing other work here — anyone with repo access already has them.

### 1. `AdminDashboard.tsx` is 2459 lines
[src/pages/AdminDashboard.tsx](src/pages/AdminDashboard.tsx) does course management, term management, upload (drag/drop + validation + progress + video pipeline), material listing/filtering/pagination, linked-URL editing, filename editing, transcript viewing, reindexing, and deletion — all in one component, ~50 inline handlers spanning lines 208–1305+.

The decomposition target already exists, half-built: [src/components/lecturer/MaterialUploadZone.tsx](src/components/lecturer/MaterialUploadZone.tsx), [MaterialsList.tsx](src/components/lecturer/MaterialsList.tsx), [UploadProgressList.tsx](src/components/lecturer/UploadProgressList.tsx). These were the original componentized upload UI, later reimplemented inline in `AdminDashboard.tsx` during a revamp, and never deleted. They're currently **dead code** (zero imports). Either extract `AdminDashboard.tsx` back into shapes like these, or delete them and start the split fresh — don't leave them as unused zombies.

### 2. `rag-chat/index.ts` is 1806 lines, one file, no local module split
[supabase/functions/rag-chat/index.ts](supabase/functions/rag-chat/index.ts) is the core student chat endpoint: 3 model tiers (fast/smart/pro), retrieval (top 18, threshold 0.50) → rerank (top 10, floor 0.55), citation-token parsing (`<<cite:N>>`), conversation history windowing (`CONVERSATION_HISTORY_CHAR_BUDGET = 9000`). Deno edge functions can import local files — nothing stops splitting this into `retrieval.ts` / `rerank.ts` / `citations.ts` / `history.ts` modules alongside `index.ts`. Currently untested (see #4) and the highest-risk file to touch blind.

### 3. Every edge function has `verify_jwt = false`
[supabase/config.toml](supabase/config.toml) disables Supabase's platform JWT verification for all 13 functions — each function must independently check the Authorization header. This is a common source of authz bugs (one function forgets the check, or checks role but not resource ownership). **Audit each function's auth logic individually**, don't assume it's consistent across them just because one is correct.

### 4. Zero test coverage on anything that matters
Only 3 test files exist:
- `src/test/example.test.ts` — literal scaffolding (`expect(true).toBe(true)`), delete it
- `src/features/student-chat/documentScope.test.ts` — real, good coverage of pure helpers
- `src/lib/materialUpload.test.ts` — real, good coverage of upload validation

**Untested**: `useStudentChat.ts` (1078L, the core chat state machine), `AdminDashboard.tsx` (2459L), every edge function including `rag-chat`, `AuthContext.tsx`, `useMaterials.ts`, `useCourses.ts`, `ffmpegAudioExtractor.ts`, `videoUploadPipeline.ts`. No integration/E2E tests, no edge function tests at all. Given #1–3 above are the riskiest files to refactor, this is the thing blocking safe refactoring of them.

## Dead code to delete

Confirmed zero references anywhere in `src/` (verified by grep):
- `src/components/lecturer/MaterialUploadZone.tsx`, `MaterialsList.tsx`, `UploadProgressList.tsx` (see #1 above — decide extract-into vs. delete, don't just leave them)
- `src/components/NavLink.tsx`
- `src/components/layout/Header.tsx`, `Footer.tsx` — from an earlier layout pattern; `MainLayout.tsx` (the one actually used by pages) doesn't reference them

**MUI is nearly unused**: `@mui/material` + `@mui/icons-material` (v7.3) are full dependencies, but the only usage in the entire codebase is one icon import in [ConversationsSidebar.tsx:2](src/features/student-chat/ConversationsSidebar.tsx#L2) (`MoreVertIcon`). Swap it for the Radix/shadcn/lucide-react equivalent already in use everywhere else, then drop both MUI packages.

## Config looseness

[tsconfig.json](tsconfig.json) / [tsconfig.app.json](tsconfig.app.json): `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`, `noUnusedLocals/Parameters: false`. Type safety is weak project-wide — worth tightening incrementally (start with `strictNullChecks`, since Supabase's generated types lean on nullability) rather than flipping `strict: true` all at once and fixing hundreds of errors blind.

## Stale/unedited scaffold files

- [README.md](README.md) — unedited Lovable.dev template, still has `REPLACE_WITH_PROJECT_ID` placeholder. Needs a real project README.
- `package.json` name is still `vite_react_shadcn_ts`, version `0.0.0`.
- [src/integrations/supabase/types.ts:8](src/integrations/supabase/types.ts#L8) has a stray `// Trigger redeployment` comment — leftover no-op edit, harmless but can be removed.
- Root has `entities.json` and `mempalace.yaml` — artifacts from an unrelated external note-taking tool, not referenced by app code. Safe to delete unless someone still uses that tool against this repo.

## Docs that describe things not fully built — reconcile or shelve

- [PLAN.md](PLAN.md) — original product spec. Describes OTP-based auth and a personal-per-student RAG index; current `Auth.tsx` doesn't clearly show an OTP flow, though a `student_documents` table does exist (partially built). Worth a pass to confirm what's actually live vs. aspirational.
- [plans/panopto.md](plans/panopto.md) — detailed plan for Panopto video-link import (OAuth, transcript import, embedded player). **Not implemented**: no `connect-panopto`/`import-panopto-session` functions, no `video_external` type, no `external_provider`/`embed_url` columns, no token storage table. The DB *does* have the generic pieces (`chunks.start_ms`/`end_ms`, `materials.duration_ms`, `material_transcript_segments`) that were likely built for the self-hosted `transcribe-video` upload flow instead. Decide: build Panopto import for real, or delete the stale plan doc so it stops looking like pending work.
- [gemini-vision.md](gemini-vision.md) — accurate and well-maintained, but explicitly lists **unimplemented** recommendations: exponential backoff on 429s (currently: single retry after a flat 2s), request queuing for the 15 RPM free-tier Gemini limit, inter-document delays for bulk uploads. Also flags a real risk: 60s edge function timeout on PDFs >30 pages, and a hard 15MB file-size ceiling.

## Migration history worth knowing before touching schema/RLS

30 migrations in [supabase/migrations/](supabase/migrations/) show real churn, not just growth — don't assume the oldest logic is still authoritative:
- Conversation limit was added ([...143000_limit_conversations_per_user.sql]) then removed ([...20260225110000_remove_conversation_limit.sql])
- A `lecturer` role was added then merged into `admin` ([...20260303160000_remove_lecturer_role.sql])
- An `organizations` table was added then dropped ([...20260503120000_drop_organizations.sql])
- Admin analytics was replaced mid-stream ([...20260303153000_replace_admin_analytics_with_course_metrics.sql])
- Access-scope/RLS policy was tightened across at least 3 separate migrations (materials access, course enrollment, chunk insert policy) — if you're touching row-level security, read all of them in order, not just the latest.

## Env vars — unverified mapping, and one thing to check

`.env` declares: `GEMINI_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, `RESEND_API_KEY`. No `.env.example` exists — add one (names only) so new engineers don't have to reverse-engineer required vars from function code.

`ASSEMBLY_API_KEY` (AssemblyAI) and `RESEND_API_KEY` (Resend email) usage wasn't traced to specific functions during this pass — likely `transcribe-video` and the course-invite functions respectively, but confirm before assuming either is dead.

**`.env` IS committed to git history** — confirmed via `git log --all --full-history -- .env` (shows up across many commits, including the current one). `.gitignore` only has generic patterns like `*.local`, never `.env` by name. **Rotate every key listed above** (`GEMINI_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, `RESEND_API_KEY`, and the Supabase publishable key) and add `.env` to `.gitignore` before doing anything else in this repo. This is the single most urgent item in this document.
