# Handoff: Technical Debt & Known Issues

Living doc for whoever picks this up next. Codebase: React 18 + Vite + TypeScript frontend, Supabase (Postgres + pgvector + Edge Functions) backend. Originated from a Lovable.dev scaffold — several artifacts below are leftovers from that.

## Start here — highest priority

### 0. Secrets are in git history — rotate before anything else
`.env` is tracked and committed (confirmed via `git log --all --full-history -- .env`, present across many commits including the current HEAD). It contains `GEMINI_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, `RESEND_API_KEY`, and the Supabase publishable key. `.gitignore` never excludes `.env` by name, only generic patterns like `*.local`. **Rotate all of these keys and add `.env` to `.gitignore`** before doing other work here — anyone with repo access already has them.

### 1. `AdminDashboard.tsx` is ~2058 lines (down from 2459, as of 2026-07-13)
[src/pages/AdminDashboard.tsx](src/pages/AdminDashboard.tsx) does course management, term management, upload (drag/drop + validation + progress + video pipeline), material listing/filtering/pagination, linked-URL editing, filename editing, transcript viewing, reindexing, and deletion — all in one component, ~40 `useState` calls.

**Update 2026-07-13:** The old half-built decomposition target (`MaterialUploadZone.tsx`, `MaterialsList.tsx`, `UploadProgressList.tsx`) was confirmed to no longer match the current upload UI (the live version has a richer pending-file list, per-file removal, and upload-index tracking those components never had) — deleted rather than resurrected. Instead extracted, all as props-driven presentational components (no state/handlers moved, parent still owns everything):
- [LinkedUrlDialog.tsx](src/components/lecturer/LinkedUrlDialog.tsx), [TranscriptDialog.tsx](src/components/lecturer/TranscriptDialog.tsx), [EnrollmentCodeDialog.tsx](src/components/lecturer/EnrollmentCodeDialog.tsx) — the 3 standalone dialogs
- [CoursesOverviewTab.tsx](src/components/lecturer/CoursesOverviewTab.tsx) — the "Courses Overview" tab's 3 cards (course create/list, academic term create/list/activate)

`Material`, `Course`, `AcademicTerm`, `TranscriptSegment`, and `formatClock` are now exported from `AdminDashboard.tsx` for these to import.

**Deliberately not extracted as a hook**: `handleCreateCourse`, `handleCreateAcademicTerm`, and `handleSetActiveTerm` all reach into upload-tab state (`uploadCourseId`, `uploadAcademicTermId`) to auto-select the newly created/activated course or term for uploads — real UX coupling, not incidental. Pulling course/term state into a `useCourseManagement` hook would need `onCourseCreated`/`onTermCreated`/`onTermActivated` callbacks to preserve that; skipped for now given zero test coverage on this file (see #4) — a JSX-only move is much lower risk than restructuring stateful cross-tab behavior blind. If someone wants that hook, this note has the exact shape needed.

**Still not done**: the "+ Add Document" tab (upload + materials list, ~20 state vars, the file's largest remaining chunk) and a 4th dialog ("Edit Filename") weren't touched.

### 2. `rag-chat/index.ts` split into `_shared/` modules (2026-07-13, was 1806 lines / 1 file)
[supabase/functions/rag-chat/index.ts](supabase/functions/rag-chat/index.ts) is the core student chat endpoint: 3 model tiers (fast/smart/pro, now OpenAI-only — see the "Model consolidation" note below), retrieval (top 18, threshold 0.50) → rerank (top 10, floor 0.55), citation-token parsing (`<<cite:N>>`), conversation history windowing (`CONVERSATION_HISTORY_CHAR_BUDGET = 9000`).

The ~20 pure functions that determine answer quality (citation parsing/remapping, chunk rerank/dedup, history windowing, document-scope handling) are now extracted into [supabase/functions/_shared/citations.ts](supabase/functions/_shared/citations.ts), [retrieval.ts](supabase/functions/_shared/retrieval.ts), [history.ts](supabase/functions/_shared/history.ts), [query.ts](supabase/functions/_shared/query.ts), each with a `.test.ts` (59 tests total, vitest). `index.ts` is down to ~1200 lines — the remaining size is request handling, Supabase queries, and the streaming response loop, which weren't extracted since they're not pure/reusable logic.

### 3. Every edge function has `verify_jwt = false`
[supabase/config.toml](supabase/config.toml) disables Supabase's platform JWT verification for all 13 functions — each function must independently check the Authorization header. This is a common source of authz bugs (one function forgets the check, or checks role but not resource ownership). **Audit each function's auth logic individually**, don't assume it's consistent across them just because one is correct.

### 4. Test coverage — real progress, still gaps (updated 2026-07-13)
Was "zero test coverage on anything that matters." Now:
- `src/test/example.test.ts` — literal scaffolding (`expect(true).toBe(true)`), still there, delete it
- `src/features/student-chat/documentScope.test.ts` / `src/lib/materialUpload.test.ts` — pre-existing, **currently failing** (source drifted from what the tests assert — label/limit strings changed without updating the tests). Not caused by today's work, not yet fixed; worth a look before trusting them.
- `supabase/functions/_shared/{citations,retrieval,history,query}.test.ts` — new, 59 tests, pure-logic coverage of rag-chat's answer-quality logic (see #2)
- `src/features/student-chat/sse.test.ts` — new, 8 tests, the client-side SSE decoder extracted from `useStudentChat.ts`
- `src/features/student-chat/useStudentChat.test.ts` — new, first hook test in this repo (`renderHook` + a hand-rolled chainable Supabase mock, see the file for the pattern). Covers `handleSend`'s send/stream/error/abort flow. **Does not cover** `fetchConversations`, `loadConversationMessages` (retry + citation hydration), `deleteConversation`, `clearAllConversations`, `openCitationSource` — lower-traffic paths touching more distinct Supabase table chains; the mocking groundwork is there if someone wants to extend it.

**Still untested**: `AdminDashboard.tsx` (2240L), every edge function's request-handling path (only the extracted pure logic in #2 has tests — the actual HTTP/streaming layer of `rag-chat` and all other functions are untested), `AuthContext.tsx`, `useMaterials.ts`, `useCourses.ts`, `ffmpegAudioExtractor.ts`, `videoUploadPipeline.ts`. No integration/E2E tests.

## Dead code to delete

Confirmed zero references anywhere in `src/` (verified by grep):
- ~~`src/components/lecturer/MaterialUploadZone.tsx`, `MaterialsList.tsx`, `UploadProgressList.tsx`~~ — deleted 2026-07-13 (see #1 above, they no longer matched the current upload UI)
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

**Update 2026-07-13:** `.env` is no longer tracked (`git log --all --full-history -- .env` now returns zero commits — it was already scrubbed/rewritten out of history by the time this was checked, contradicting the paragraph below written earlier). Still rotate all keys on their provider dashboards as a precaution before trusting old exposure is fully contained, since history rewrites don't undo any access already taken with the old keys.

~~**`.env` IS committed to git history**~~ — confirmed via `git log --all --full-history -- .env` (shows up across many commits, including the current one). `.gitignore` only has generic patterns like `*.local`, never `.env` by name. **Rotate every key listed above** (`GEMINI_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, `RESEND_API_KEY`, and the Supabase publishable key) and add `.env` to `.gitignore` before doing anything else in this repo. This is the single most urgent item in this document.

## Model consolidation — chat swapped to OpenAI-only (2026-07-13)

`rag-chat`'s `smart`/`pro` tiers and `generate-flashcards` previously called Gemini for plain text-in/text-out chat generation. Both now go through OpenAI only, via a new shared wrapper [supabase/functions/_shared/llm.ts](supabase/functions/_shared/llm.ts) built on the Vercel AI SDK (`ai` + `@ai-sdk/openai`, pulled in via `esm.sh` like every other npm dependency in these functions — no import map needed). `GEMINI_API_KEY` is no longer read for chat.

**Not swapped — still on Gemini, deliberately:**
- **Embeddings** (`gemini-embedding-001`, used in `ingest-material`, `process-material-job`, `transcribe-video`, `rag-chat`'s `embedQuery`). Switching embedding models means re-embedding every existing chunk in pgvector — vectors from different models aren't comparable. Not attempted; would need its own migration.
- **`process-material-job`'s `extractTextWithGemini`** — this isn't chat, it's document OCR: raw PDF/image bytes sent to Gemini's vision API (`generateContent` with `inlineData`), returning page-marked extracted text. This is the pipeline `gemini-vision.md` documents (retry/RPM tuning, 15MB file ceiling). Swapping providers here means adopting a new input format and re-validating extraction quality, not a config change — see the GLM-OCR note below for a candidate alternative.

## Candidate: GLM-OCR as a cheaper document-OCR alternative

Researched 2026-07-13 in response to wanting to reduce document-OCR cost. [GLM-OCR](https://github.com/zai-org/GLM-OCR) (Zhipu/Z.ai) offers a hosted API priced at $0.03/1M tokens uniform in/out — vs. Gemini 2.5 Flash's $0.30/1M input, $2.50/1M output (paid tier, per Google's published pricing at the time of this note). GLM-OCR's hosted API also supports 50MB PDFs up to 100 pages, above the 15MB ceiling this codebase currently hits.

Self-hosting GLM-OCR (Apache/MIT licensed, 0.9B params, runs via vLLM/SGLang/Ollama) was ruled out: Supabase Edge Functions run on Deno Deploy, which can't run GPU inference, so self-hosting would mean standing up a separate inference server — a new infra dependency, not a swap.

The **hosted** GLM-OCR API doesn't have that problem, but it's still a third vendor alongside OpenAI (chat/STT) and Gemini (embeddings/OCR) rather than a consolidation. Not adopted yet — pricing/quality claims are from vendor docs, unverified against this codebase's actual PDFs/slides. If document-OCR cost or the 15MB ceiling becomes a real pain point, this is the first thing to prototype against `process-material-job`'s `extractTextWithGemini`.

## Candidate: AssemblyAI → OpenAI STT swap (planned, not implemented, 2026-07-13)

`ASSEMBLY_API_KEY` (AssemblyAI) currently powers video transcription via `transcribe-video` + `upload-video`. Sunsetting it for OpenAI's transcription API (`whisper-1` / `gpt-4o-transcribe`) was scoped but **not implemented** — it's a pipeline restructure, not a config swap:

- **AssemblyAI's flow is async and two-step**: `upload-video` proxies the raw video file to AssemblyAI's own upload endpoint (`https://api.assemblyai.com/v2/upload`), gets back an AssemblyAI-hosted URL, then `transcribe-video` submits that URL as a transcription job and polls (`submitToAssemblyAI` / `pollAssemblyAI` in [supabase/functions/transcribe-video/index.ts](supabase/functions/transcribe-video/index.ts)) until AssemblyAI's servers finish processing. No file size limit on AssemblyAI's side.
- **OpenAI's `/v1/audio/transcriptions` is synchronous**: you POST actual audio bytes directly (multipart form), and the transcript comes back in one call — no hosted-URL step, no polling. That means `upload-video`'s entire job (proxy-upload to get a URL) goes away.
- **Consequence**: the file needs to reach `transcribe-video` as bytes some other way — most likely the client uploads the video to Supabase Storage first (this stack already has Storage available), and `transcribe-video` reads it from there before POSTing to OpenAI.
- **File size**: OpenAI's transcription endpoint caps around 25MB per request. AssemblyAI has no such cap. Long lecture videos will likely need audio extraction (this repo already has `ffmpegAudioExtractor.ts` for client-side audio extraction — check whether that gets you under 25MB, or whether chunking/splitting is needed for very long recordings) before this swap is viable end-to-end.
- **Timeout note**: `transcribe-video` currently runs its poll loop inside an `EdgeRuntime.waitUntil` background task, which isn't bound by the 60s HTTP response window, so long AssemblyAI jobs don't time out. A single long synchronous OpenAI call inside that same background task should be fine for the same reason, but hasn't been verified against Deno Deploy's background-task ceiling.
- **Frontend**: [src/lib/videoUploadPipeline.ts](src/lib/videoUploadPipeline.ts) orchestrates `upload-video` → `transcribe-video` and would need its Step 1 rewritten (Storage upload instead of AssemblyAI proxy).

Whoever picks this up: start by confirming whether client-side audio extraction (already implemented) reliably gets lecture-length videos under OpenAI's 25MB cap before committing to the Storage-upload restructure.
