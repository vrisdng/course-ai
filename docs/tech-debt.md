# Tech Debt Backlog

Strategic backlog of known tech debt for EduChat, ordered by priority. Effort estimates assume one engineer working focused. This is the **planning** doc — read `HANDOFF.md` first for the landmines that will bite you while editing a specific file.

Effort legend: 🟢 quick (< 1 hr) · 🟡 medium (half-day to a couple days) · 🔴 large (multi-day / risky).

---

## P0 — Security & irreversible

### 0.1 Rotate all provider secrets [🟢]
`.env` was historically committed across many commits and appears in git history. It is now excluded by `.gitignore`, but rewriting history does not undo access already taken with old keys. Rotate on provider dashboards as a precaution:
- ✅ **Rotated (2026-09-13):** `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, Supabase project tokens.
- ⚠️ **Still needs rotation:** `GEMINI_API_KEY`, `RESEND_API_KEY` (not confirmed rotated).

See `HANDOFF.md` §0.

### 0.2 Switch embeddings from Gemini → OpenAI [🔴 — the big one]
Chat was already consolidated to OpenAI (`HANDOFF.md` "Model consolidation"). Embeddings are the last large Gemini dependency and the explicit next item.

**Current state:** `gemini-embedding-001` is called via raw `fetch` in 4 edge functions — `ingest-material`, `transcribe-video`, `process-material-job` (batch), `rag-chat` (`embedQuery`). Query embeddings use `taskType: RETRIEVAL_QUERY`; doc embeddings use `RETRIEVAL_DOCUMENT`, both `outputDimensionality: 1536`. Notably, embeddings **do not** route through the shared `_shared/llm.ts` wrapper (a deviation from the "one LLM wrapper" convention) — the embedding code is duplicated 4× with its own inline retry logic.

**Target:** `text-embedding-3-large` (1536-dim). One model serves query + doc, so the `taskType` split goes away — a genuine simplification.

**The hard part — re-embedding existing data:** vectors from different models are not comparable. Every existing chunk in `pgvector` was embedded with Gemini; a live swap would break retrieval instantly. A migration is required to re-embed all existing chunks.

**Phased plan:**
1. **Shared module** — create `supabase/functions/_shared/embed.ts` (single embedding code path, reads `OPENAI_API_KEY`, batched with a token-budget guard, 429/5xx retry). Right now this rule is violated 4×.
2. **Re-embed migration** — add an `embedding_provider` marker column to `chunks` (default `gemini-embedding-001`), then a resumable `re-embed-chunks` edge function (service-role client) that re-embeds `material_id IS NOT NULL` chunks not yet tagged `openai:text-embedding-3-large`. Dims stay 1536, so the existing ivfflat index needs no rebuild.
3. **Wire call sites** — replace the 4 inline implementations with the shared module; drop `geminiApiKey` plumbing + `GEMINI_API_KEY` embedding guards.
4. **Rollout ordering** — deploy new code → run `re-embed-chunks` to 100% → flip secrets → deploy the Gemini-removing code. Zero-downtime variant: dual-write embeddings into a new column, flip `rag-chat` to read it, then drop Gemini.
5. **Docs/secrets** — update `gemini-vision.md`, `supabase secrets` (Gemini then needed only for OCR), `GET_STARTED.md` model tables, `HANDOFF.md`.

After this swap, Gemini is used only for document OCR (`extractTextWithGemini`). Combined with the planned AssemblyAI→OpenAI STT swap, Gemini becomes a single-purpose OCR dependency.

---

## P1 — Code health

### 1.1 Tighten TypeScript strictness [🟡]
`tsconfig` has `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`. `npm run lint` (eslint) reports **0 errors** (fixed 2026-09-13), but bare `tsc --noEmit` still surfaces type errors (e.g. pre-existing spread-arg issues in `useStudentChat.test.ts`) and type safety is weak project-wide. Tighten **incrementally** — start with `strictNullChecks` (Supabase's generated types lean on nullability), not `strict: true` blindly.

### 1.2 Decompose `AdminDashboard.tsx` [🔴]
~2058 lines (down from 2459), ~40 `useState` calls: course/term management, upload (drag/drop + validation + progress + video pipeline), material listing/filtering/pagination, linked-URL editing, filename editing, transcript viewing, reindexing, deletion. Partially decomposed — `LinkedUrlDialog`, `TranscriptDialog`, `EnrollmentCodeDialog`, `CoursesOverviewTab` extracted as props-driven presentational components. **Still not done:** the "+ Add Document" tab (upload + materials list, ~20 state vars, the largest remaining chunk) and the "Edit Filename" dialog. Skipped as a hook because some handlers reach into other tabs' state (real UX coupling); a JSX-only move is much lower risk given zero test coverage on this file.

### 1.3 Thin test coverage [🟡]
`npm run test` = 239/239 passing. Coverage exists for `rag-chat`'s extracted pure logic (`_shared/{citations,retrieval,history,query}`), SSE, and the `useStudentChat` hook's send/stream/abort flow. **Still untested** (no safety net — verify manually): `AdminDashboard.tsx`, `useStudentChat.ts` (lower-traffic paths: `fetchConversations`, `loadConversationMessages`, `deleteConversation`, `clearAllConversations`), `AuthContext.tsx`, `useMaterials.ts`, `useCourses.ts`, `ffmpegAudioExtractor.ts`, `videoUploadPipeline.ts`, and every edge function's request-handling/streaming layer. No integration/E2E tests.

---

## P2 — Operational

### 2.1 `reap-stale-jobs` has no scheduled runner [🟡]
`reap-stale-jobs` resets jobs stuck "processing" >5 min and propagates failures after 5 attempts, but no `pg_cron` schedule is checked into migrations. Confirm whether it's wired via the Supabase dashboard cron scheduler before assuming stuck jobs self-heal in a given environment.

### 2.2 OCR hardening in `process-material-job` [🟡 — partly done 2026-09-21]
Done: page-range resumable extraction (16 pages/call, progress persisted per range), 90 s per-call timeout, exponential backoff on 429/5xx for Vision calls, chunked base64 encoding, `claim_material_processing_job` scoped to the requested material (it previously re-ran the oldest stale job instead — see migration `20260921150000`). Remaining: apply the backoff helper to embedding calls; hard 15MB file-size ceiling (Gemini inline-vision constraint); Gemini key must stay on the paid tier (free tier measured at 5 RPM + constant 503s). Candidate alternative: hosted GLM-OCR ($0.03/1M tokens uniform, 50MB/100-page cap) — see `HANDOFF.md` "GLM-OCR" note.

### 2.3 AssemblyAI → OpenAI STT [🟡]
Scoped but not implemented (`HANDOFF.md`). AssemblyAI's flow is async/two-step (`upload-video` proxies to an AssemblyAI-hosted URL, `transcribe-video` polls); OpenAI's `/v1/audio/transcriptions` is synchronous (POST audio bytes, one call) — so `upload-video`'s proxy-upload goes away and the client would need to upload to Supabase Storage first. OpenAI caps ~25MB/request; verify client-side audio extraction (`ffmpegAudioExtractor.ts`, currently **unused** anywhere) gets lecture videos under that cap before committing.

---

## P3 — Hygiene (resolved — kept for the record)

All resolved 2026-07/09 unless noted. Active debts live in the sections above.

- ✅ MUI fully removed — `@mui/material` + `@mui/icons-material` dropped; `ConversationsSidebar` now uses lucide's `MoreVertical`.
- ✅ Dead code removed — `MaterialUploadZone.tsx`, `MaterialsList.tsx`, `UploadProgressList.tsx`, `NavLink.tsx` (deleted). `Header.tsx`/`Footer.tsx` were mislisted as dead — `MainLayout.tsx` **uses** them.
- ✅ Scaffold test `src/test/example.test.ts` (`expect(true).toBe(true)`) deleted.
- ✅ `materialUpload.test.ts` / `documentScope.test.ts` corrected to match source (were failing), now pass.
- ✅ Lint clean — 0 errors (was failing on `any`, `@ts-ignore`, empty blocks, `require()`).
- ✅ `.env.example` added (names only).
- ✅ `lovable-tagger` removed from `vite.config.ts`.
- ✅ `package.json` renamed to `edu-chat` (was `vite_react_shadcn_ts`), version set to `1.0.0`.
- ✅ Stale `bun.lockb` removed; `entities.json` / `mempalace.yaml` (unrelated note-taking artifacts) deleted.

---

## Open questions / candidates

- **GLM-OCR** — hosted API alternative to Gemini Vision for `extractTextWithGemini`; cheaper ($0.03/1M tokens uniform) and 50MB/100-page cap vs. Gemini's 15MB ceiling. Still a third vendor; unverified against real PDFs. Self-hosting ruled out (Deno Deploy can't run GPU inference). See `HANDOFF.md`.
- **Panopto import** — `plans/panopto.md` describes OAuth/transcript/import flow that is **not implemented** (no `connect-panopto`/`import-panopto-session` functions, no `video_external` type). The DB has generic pieces (`chunks.start_ms`/`end_ms`, `materials.duration_ms`, `material_transcript_segments`) likely built for the self-hosted `transcribe-video` flow instead. Decide: build it, or delete the stale plan doc. See `HANDOFF.md`.
- **CI/CD** — no `.github/workflows`; deploys are push-triggered by Vercel (frontend) and manual CLI push (Supabase migrations/functions). Worth adding a pipeline.
