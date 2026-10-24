# Handoff: Technical Debt & Known Issues

Living doc for whoever picks this up next. Codebase: React 18 + Vite + TypeScript frontend, Supabase (Postgres + pgvector + Edge Functions) backend. Originated from a Lovable.dev scaffold — several artifacts below are leftovers from that.

**Active/prioritized tech-debt backlog lives in [docs/tech-debt.md](docs/tech-debt.md)** (ordered by effort/risk, with the Gemini→OpenAI embedding plan). This file tracks what will bite you while editing a specific file; the backlog is what you schedule work against.

## Start here — highest priority

### 0. Secrets — rotate, then verify `.env` is gitignored
`.env` historically appeared in many commits (confirmed via `git log --all --full-history -- .env`). It is now excluded by `.gitignore`, but rewriting history does not undo access already taken with old keys, so still rotate on the provider dashboards:
- **Rotated (2026-09-13):** `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, Supabase project tokens.
- **Still rotate before trusting old exposure is contained:** `GEMINI_API_KEY`, `RESEND_API_KEY`, and the Supabase publishable key.

All keys above should also be set on the Supabase project (separate from local `.env`) via `supabase secrets set …` — see README step 5.

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
[supabase/config.toml](supabase/config.toml) disables Supabase's platform JWT verification for all 13 functions — each function must independently check the Authorization header. The Vercel renderer (`api/render-pdf-pages.ts`) is outside this list and uses a shared secret instead — see "Page images + citation highlights". This is a common source of authz bugs (one function forgets the check, or checks role but not resource ownership). **Audit each function's auth logic individually**, don't assume it's consistent across them just because one is correct.

### 4. Test coverage — real progress, still gaps (updated 2026-09-13)
Was "zero test coverage on anything that matters." Now:
- ~~`src/test/example.test.ts` — literal scaffolding (`expect(true).toBe(true)`), still there, delete it~~ — deleted 2026-09-13
- `src/features/student-chat/documentScope.test.ts` / `src/lib/materialUpload.test.ts` — pre-existing; now **passing** (the drifted label/limit strings were corrected to match the source, 2026-09-13)
- Lint: `npm run lint` reports **0 errors** (was failing on `any`, `@ts-ignore`, empty blocks, `require()` — fixed 2026-09-13)
- `supabase/functions/_shared/{citations,retrieval,history,query}.test.ts` — new, 59 tests, pure-logic coverage of rag-chat's answer-quality logic (see #2)
- `src/features/student-chat/sse.test.ts` — new, 8 tests, the client-side SSE decoder extracted from `useStudentChat.ts`
- `src/features/student-chat/useStudentChat.test.ts` — new, first hook test in this repo (`renderHook` + a hand-rolled chainable Supabase mock, see the file for the pattern). Covers `handleSend`'s send/stream/error/abort flow. **Does not cover** `fetchConversations`, `loadConversationMessages` (retry + citation hydration), `deleteConversation`, `clearAllConversations`, `openCitationSource` — lower-traffic paths touching more distinct Supabase table chains; the mocking groundwork is there if someone wants to extend it.

**Still untested**: `AdminDashboard.tsx` (2240L), every edge function's request-handling path (only the extracted pure logic in #2 has tests — the actual HTTP/streaming layer of `rag-chat` and all other functions are untested), `AuthContext.tsx`, `useMaterials.ts`, `useCourses.ts`, `ffmpegAudioExtractor.ts`, `videoUploadPipeline.ts`. No integration/E2E tests.

## Resolved debt — moved to [docs/tech-debt.md](docs/tech-debt.md)

The items below are **resolved** and kept here only as history. The active backlog (incl. the Gemini→OpenAI embedding swap) is in [docs/tech-debt.md](docs/tech-debt.md).

- ~~`src/components/lecturer/MaterialUploadZone.tsx`, `MaterialsList.tsx`, `UploadProgressList.tsx`~~ — deleted 2026-07-13 (see #1 above, they no longer matched the current upload UI)
- ~~`src/components/NavLink.tsx`~~ — deleted 2026-09-13
- ~~`src/components/layout/Header.tsx`, `Footer.tsx`~~ — **used** by `MainLayout.tsx`, not dead (the "doesn't reference them" note was wrong)
- ~~MUI~~ — `@mui/material` + `@mui/icons-material` fully removed; `ConversationsSidebar` now uses lucide's `MoreVertical`

## Config looseness

[tsconfig.json](tsconfig.json) / [tsconfig.app.json](tsconfig.app.json): `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`, `noUnusedLocals/Parameters: false`. Type safety is weak project-wide — worth tightening incrementally (start with `strictNullChecks`, since Supabase's generated types lean on nullability) rather than flipping `strict: true` all at once and fixing hundreds of errors blind.

## Minor scaffold leftovers (unresolved)

- [src/integrations/supabase/types.ts:8](src/integrations/supabase/types.ts#L8) has a stray `// Trigger redeployment` comment — leftover no-op edit, harmless but can be removed.

**Resolved:** `REPLACE_WITH_PROJECT_ID` is gone from README.md, `package.json` is now `cee-chat`/`1.0.0`, and `entities.json` + `mempalace.yaml` were deleted (2026-09-13).

## Docs that describe things not fully built — reconcile or shelve

- [PLAN.md](PLAN.md) — original product spec. Describes OTP-based auth and a personal-per-student RAG index; current `Auth.tsx` doesn't clearly show an OTP flow, though a `student_documents` table does exist (partially built). Worth a pass to confirm what's actually live vs. aspirational.
- [plans/panopto.md](plans/panopto.md) — detailed plan for Panopto video-link import (OAuth, transcript import, embedded player). **Not implemented**: no `connect-panopto`/`import-panopto-session` functions, no `video_external` type, no `external_provider`/`embed_url` columns, no token storage table. The DB *does* have the generic pieces (`chunks.start_ms`/`end_ms`, `materials.duration_ms`, `material_transcript_segments`) that were likely built for the self-hosted `transcribe-video` upload flow instead. Decide: build Panopto import for real, or delete the stale plan doc so it stops looking like pending work.
- [gemini-vision.md](gemini-vision.md) — updated 2026-09-21 for page-range extraction + backoff; still lists **unimplemented** recommendations: exponential backoff for embedding calls (Vision calls now have it), and originally: exponential backoff on 429s (currently: single retry after a flat 2s), request queuing for the 15 RPM free-tier Gemini limit, inter-document delays for bulk uploads. Also flags a real risk: 60s edge function timeout on PDFs >30 pages, and a hard 15MB file-size ceiling.

## Migration history worth knowing before touching schema/RLS

30 migrations in [supabase/migrations/](supabase/migrations/) show real churn, not just growth — don't assume the oldest logic is still authoritative:
- Conversation limit was added ([...143000_limit_conversations_per_user.sql]) then removed ([...20260225110000_remove_conversation_limit.sql])
- A `lecturer` role was added then merged into `admin` ([...20260303160000_remove_lecturer_role.sql])
- An `organizations` table was added then dropped ([...20260503120000_drop_organizations.sql])
- Admin analytics was replaced mid-stream ([...20260303153000_replace_admin_analytics_with_course_metrics.sql])
- Access-scope/RLS policy was tightened across at least 3 separate migrations (materials access, course enrollment, chunk insert policy) — if you're touching row-level security, read all of them in order, not just the latest.

## Env vars — unverified mapping, and one thing to check

`.env` declares: `GEMINI_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, `RESEND_API_KEY`. `.env.example` (names only) now exists — see it.

`ASSEMBLY_API_KEY` (AssemblyAI) and `RESEND_API_KEY` (Resend email) usage wasn't traced to specific functions during this pass — likely `transcribe-video` and the course-invite functions respectively, but confirm before assuming either is dead.

## Page images + block citations (2026-10-07, blocks 2026-10-09)

Clicking a PDF citation shows the cited page as a pre-rendered image with exactly the cited parts (a paragraph, an equation, a figure...) outlined, instead of downloading the whole PDF. It replaces the earlier thumbnail pipeline (`_shared/pdfThumbnail.ts`, `pdf-page-thumbnail`), which never produced an image: Deno has no canvas, and the frontend fetched a relative URL that hit Vercel's SPA fallback.

**Ingestion flow for a PDF** (renderer configured), all in one `process-material-job` job via the usual requeue:
1. **Page images** (`payload.pageRender`, `_shared/pageImages.ts`): 20 pages per run. The job signs a download URL for the PDF and an upload URL per page, then POSTs them to `api/render-pdf-pages.ts` (Vercel, Node). That renders with pdf.js + `@napi-rs/canvas`, uploads `course-materials/page-images/<material_id>/page-<n>.webp`, and returns each page's text lines with boxes. These go into `material_pages`.
2. **Blocks** (`payload.blockExtraction`, `_shared/blockExtraction.ts` + `blocks.ts`): 6 page images per OCR call (`gpt-5.6-luna`, `llm.ts#generatePageImagesText`). Each call returns blocks: `{type, box (0-1000 grid), text}`, with maths in LaTeX and figures described. Text blocks' boxes are snapped onto the page's real text lines. Figures and equations are shifted by the offset measured on the snapped blocks. Results go into `page_blocks`.
3. **Chunks** are packed from whole blocks (`chunkBlocks`, max 1200 chars, no paragraph split, headings kept with the next block). Each chunk stores `chunks.block_ids` and `chunks.highlight_box` (the union). Then the existing embedding stage runs.

**Why images, not the PDF:** with the PDF file as input, the model's boxes were unusable (median overlap 0 with the true text; 4/21 box centres inside). With rendered images they're within about a line, and snapping makes text exact.

**Answering:** `rag-chat` loads each retrieved chunk's blocks (`_shared/sourceBlocks.ts`) and shows them labelled `[3a]`, `[3b]`... (`citations.ts#formatLabelledBlocks`). The model cites `<<cite:3b>>` or `<<cite:3b,3c>>`, or `<<cite:3>>` for the whole chunk. `sanitizeAndRemapCitations` gives each distinct (source, blocks) pair its own final number. Citations carry `blockIds` (also saved in `citations.block_ids`), and the excerpt is the cited blocks' text. The frontend still only sees `<<cite:N>>`. Pipeline version: `2026-10-09-cite-blocks-v1`.

**Viewer:** `useStudentChat` → `pageImage.ts#loadBlockBoxes` picks the first cited block's page and outlines every cited block on it (`HighlightedPageImage` draws several boxes). With no `blockIds` it falls back to the chunk's box, and without a page image to react-pdf.

**Trust boundary:** the Vercel function holds **no Supabase credentials**. It checks `RENDER_SERVICE_SECRET` (constant-time) and only fetches from or uploads to URLs on the Supabase origin, via short-lived signed URLs (PDF: 10 min; uploads: Supabase's 2 h).

**Failure handling:** if rendering fails or any page lacks an image, the job restarts as the old plain-text PDF extraction (`payload.skipPageImages`). The material then gets no blocks or highlights, but it isn't left unprocessed. Unset `RENDER_SERVICE_*` secrets skip straight to that path. A block-reading failure (e.g. the model returns nothing parseable) fails the job like any OCR failure would.

**Known limits:**
- **Scanned PDFs:** with no text layer, boxes are the model's own, typically within a line.
- **Citation accuracy is unmeasured beyond spot checks.** One local test cited exactly the right paragraph for each claim. `eval/rag` could measure it properly.
- **OCR input cost is higher:** page images cost ~3k input tokens per page versus ~700 for the PDF file.
- **Existing materials** have no page images or blocks until reprocessed. There's no backfill trigger yet.
- **Over-asking:** the first render batch asks for 20 pages before the page count is known; pages past the end are ignored.
- **Image size:** ~1400px WebP q80, roughly 150–250 KB per text-heavy page.
- **Cleanup still to do:** the deleted `pdf-page-thumbnail` function stays **deployed** until `supabase functions delete pdf-page-thumbnail`. `materials.thumbnail_path` is unused but kept, because `transcribe-video` still writes `null` to it.

## Office documents → PDF (2026-10-08)

DOCX/PPTX uploads are converted to PDF and then processed as PDFs, so they get page images, blocks (with LaTeX maths) and block-level citations. Before this, their text came from the document XML: equations were dropped and page numbers were guessed.

- **Flow:** on a fresh DOCX/PPTX job, `process-material-job` signs a download URL for the original and runs a CloudConvert job (import/url → convert → export/url) on the sync endpoint (`_shared/officeConversion.ts`). It downloads the PDF, stores it at `course-materials/converted/<material_id>.pdf`, records `materials.converted_pdf_path` and requeues the job with `filePath` set to the PDF. From there the PDF pipeline runs unchanged.
- **Viewer:** `resolveCitationSource` previews converted materials through their PDF (`previewAsPdf`), so citations open as page images with the cited blocks highlighted. `materials.file_path` still points at the original.
- **Local stack:** CloudConvert can't reach `kong:8000`, so when `SUPABASE_URL` is a local host the function downloads the original and uploads it to CloudConvert (`import/upload`) instead of passing a signed URL (`cloudConvertImportMode`).
- **Fallback:** if `CLOUDCONVERT_API_KEY` is unset or conversion fails, the job falls through to the old XML extraction (logged as a warning).
- **Trust boundary:** CloudConvert receives a 10-minute signed URL for the original and stores the files temporarily under its own retention policy. Conversions use CloudConvert credits; a failed or out-of-credit job falls back to XML extraction.
- **History:** this replaced a self-hosted LibreOffice container (`services/office-converter`, removed 2026-10-17; see git history).
- **Limits:**
  - PowerPoint equations depend on the fallback picture PowerPoint saves with each one. Test decks made with pandoc have none, so their equations convert blank. This hasn't yet been verified on a PowerPoint-authored deck.
  - Deleting a material doesn't remove `converted/` or `page-images/` objects.
  - `.doc`/`.ppt` aren't converted yet; LibreOffice handles them too.
## Agentic retrieval in rag-chat (2026-10-17)

`rag-chat` no longer searches before calling the model. The model searches the course itself with a `search_course_materials` tool, as often as it needs (up to 4 searches; `MAX_AGENT_STEPS = 5` model turns), then answers. Searches past the cap get a "limit reached" reply instead of running (one step can hold several parallel calls). If the model spends its last step searching, `generateAgentTextStream` runs one more turn with tools off so the student still gets an answer instead of an error.

- **Source numbering:** each chunk the model is shown gets one source number for the whole answer, via `SourceRegistry` in [`_shared/courseSearch.ts`](supabase/functions/_shared/courseSearch.ts). A chunk found by a second search keeps its first number, so `<<cite:N>>` and block citations (`<<cite:3b>>`) can't overlap across searches. The source cap is sized as searches × results per search (`sourceLimitForSearches`), so a later search's results are never dropped. If a search does hit the cap, the tool says so instead of reporting "no match" (which could otherwise push the model into a general-knowledge answer). After the run, `registry.list()` is the source list for citation clean-up, video evidence, citations and analytics, exactly as the pre-fetched list was before.
- **Search:** one search reuses the existing pipeline with the course's chat settings: embed, `match_chunks` within course and document filter, `getRetrievalSettings` thresholds and counts, rerank with `semanticWeight`, summary spreading (`spreadAcrossTimeline`, `videoSpreadWindowMs`) and the relevance floor. It is bound to the caller's course, identity and selected documents in code; the model only supplies the query. Page blocks and image paths are loaded only for sources shown for the first time.
- **Model call:** [`llm.ts#generateAgentTextStream`](supabase/functions/_shared/llm.ts) uses the OpenAI **Responses API**, because Chat Completions rejects function tools on these reasoning models, with `store: false`. Stream handling is in [`_shared/agentStream.ts`](supabase/functions/_shared/agentStream.ts).
- **Streaming:** `rag-chat` sends SSE `status` ("Searching course materials for …") when a search starts, and `reset` when text was streamed before a search; that text isn't part of the answer. The student chat shows the status in place of "Thinking..." and clears its text on `reset`.
- **Settings with no effect now:** `queryRewriteEnabled` (`course_chat_settings.query_rewrite_enabled`): the up-front query rewrite is gone because the model writes its own search queries. `maxAnswerTokens` was already not applied (AI SDK v4 reads `maxTokens`, `buildGenerationOptions` passes `maxOutputTokens`) and the agent path doesn't pass it either. A settings editor should hide or relabel the rewrite toggle.
- **Removed:** the shortcut answer when a document filter returned nothing. With a filter, the prompt tells the model to say the answer isn't in the selected documents.
- `skipRag` (no-materials mode) is unchanged and never searches.
- **Cost and latency:** every course answer now takes at least two model turns (search, then answer); greetings answer directly. Locally, a two-part question ran two searches and finished in about 12 s.

## Model consolidation — chat swapped to OpenAI-only (2026-07-13)

`rag-chat`'s `smart`/`pro` tiers and `generate-flashcards` previously called Gemini for plain text-in/text-out chat generation. Both now go through OpenAI only, via a new shared wrapper [supabase/functions/_shared/llm.ts](supabase/functions/_shared/llm.ts) built on the Vercel AI SDK (`ai` + `@ai-sdk/openai`, pulled in via `esm.sh` like every other npm dependency in these functions — no import map needed). `GEMINI_API_KEY` is no longer read for chat.

**Not swapped — still on Gemini, deliberately:**
- **`process-material-job`'s `extractTextWithGemini`** — now used only for legacy `.doc` (PDF/image OCR moved to OpenAI `gpt-5.6-luna` via `_shared/llm.ts#generateDocumentText` on 2026-09-21). It's document OCR: raw file bytes sent to Gemini's vision API (`generateContent` with `inlineData`), returning page-marked extracted text. This is the pipeline `gemini-vision.md` documents (retry/RPM tuning, 15MB file ceiling). Swapping providers here means adopting a new input format and re-validating extraction quality, not a config change — see the GLM-OCR note below for a candidate alternative.

## Embeddings swapped to OpenAI (2026-10-01)

Embeddings moved from `gemini-embedding-001` (1536 dims, `chunks.embedding`) to OpenAI `text-embedding-3-large` (3072 dims, `chunks.embedding_openai`, searched by `match_chunks_openai`). Every embedding call — ingestion (`ingest-material`, `process-material-job`, `transcribe-video`), query embedding in `rag-chat`, and backfills — goes through one service: [`_shared/embeddings.ts`](supabase/functions/_shared/embeddings.ts) (model, dimensions, batching, validation, and the column/function names) with the OpenAI binding in `_shared/llm.ts#createOpenAIEmbeddingService`.

- **Changing the embedding model** means: update `DEFAULT_EMBEDDING_CONFIG`, add a column + match function for the new vectors, backfill with `backfill-embeddings`, switch `EMBEDDING_COLUMN`/`MATCH_CHUNKS_FUNCTION`, and **re-calibrate `getRetrievalSettings`** — score scales differ per model (Gemini put off-topic questions at up to 0.62; text-embedding-3-large keeps them under 0.30). Calibrate with **short, casual questions** as well as specific ones: on text-embedding-3-large, "when is the exam" scores its answering chunk at 0.33, while LLM-written specific questions all scored 0.48+. A first calibration on specific questions alone set the floor at 0.35 and made short questions return nothing.
- **`backfill-embeddings`** is an operator-only edge function (`auth: 'secret'` — rejects user JWTs and the publishable key). It embeds up to `limit` chunks missing `embedding_openai` per call and returns `remaining`; call until 0. Idempotent.
- **No ANN index on `embedding_openai`:** pgvector only indexes `vector` up to 2000 dims (3072 needs a `halfvec` expression index), and the match function filters by course/term/access after scoring, which an approximate index would truncate. Exact scan is fine at ~1.6k chunks; revisit if the table grows by orders of magnitude.
- **`match_chunks_openai` binds the caller to `auth.uid()`** and isn't executable by `anon`. The old `match_chunks` overloads trust a caller-supplied `user_id` and are executable by `anon` — drop them in the cleanup migration (with `chunks.embedding` and its ivfflat index).
- **Migrations aren't tracked remotely:** `supabase_migrations.schema_migrations` is empty on the hosted project, so `supabase db push` would try to replay every migration. This one was applied via the Management API SQL endpoint.

## Candidate: GLM-OCR as a cheaper document-OCR alternative

Researched 2026-07-13 in response to wanting to reduce document-OCR cost. [GLM-OCR](https://github.com/zai-org/GLM-OCR) (Zhipu/Z.ai) offers a hosted API priced at $0.03/1M tokens uniform in/out — vs. Gemini 2.5 Flash's $0.30/1M input, $2.50/1M output (paid tier, per Google's published pricing at the time of this note). GLM-OCR's hosted API also supports 50MB PDFs up to 100 pages, above the 15MB ceiling this codebase currently hits.

Self-hosting GLM-OCR (Apache/MIT licensed, 0.9B params, runs via vLLM/SGLang/Ollama) was ruled out: Supabase Edge Functions run on Deno Deploy, which can't run GPU inference, so self-hosting would mean standing up a separate inference server — a new infra dependency, not a swap.

The **hosted** GLM-OCR API doesn't have that problem, but it's still a third vendor alongside OpenAI (chat/STT) and Gemini (embeddings/OCR) rather than a consolidation. Not adopted yet — pricing/quality claims are from vendor docs, unverified against this codebase's actual PDFs/slides. If document-OCR cost or the 15MB ceiling becomes a real pain point, this is the first thing to prototype against `process-material-job`'s `extractTextWithGemini`.

## Stored video rollout (Cloudflare R2, 2026-10-09)

The new flow writes video bytes directly to private Cloudflare R2 through resumable multipart uploads (no application size ceiling; limited by R2's object and multipart limits), saves an idempotent material row and multipart ledger, submits a signed R2 URL to AssemblyAI, and uses a webhook plus scheduled reconciler to stage timed transcript segments and embedded RAG chunks. Playback uses renewed signed URLs, and transcript timestamps seek in the player. `video-upload-session` also performs provider-aware deletion and aborts abandoned multipart uploads.

**Deployment is not implied by merge.** Apply the three video migrations, configure R2, CORS, AssemblyAI webhook, and Vault secrets, then deploy the affected functions listed in [README.md](README.md). The scheduling migration installs the reconciler and upload-reaper cron jobs. The hosted migration history may be empty even when schema objects already exist; inspect it before running `supabase db push` so old migrations are not replayed against production. The old `upload-video` proxy function remains in the tree but is no longer called by the browser upload path.

No byte ceiling rejects a video; AssemblyAI's duration, source-size, format, and operational constraints can still reject transcription. A video rejected only by AssemblyAI remains playable and exposes an explicit retry. Before production rollout, verify an authenticated browser upload, playback/seek, transcript-backed RAG citation, and deletion against the intended R2 environment.

## Historical candidate: AssemblyAI → OpenAI STT swap (planned, not implemented, 2026-07-13)

`ASSEMBLY_API_KEY` (AssemblyAI) currently powers video transcription via `transcribe-video` + `upload-video`. Sunsetting it for OpenAI's transcription API (`whisper-1` / `gpt-4o-transcribe`) was scoped but **not implemented** — it's a pipeline restructure, not a config swap:

- **AssemblyAI's flow is async and two-step**: `upload-video` proxies the raw video file to AssemblyAI's own upload endpoint (`https://api.assemblyai.com/v2/upload`), gets back an AssemblyAI-hosted URL, then `transcribe-video` submits that URL as a transcription job and polls (`submitToAssemblyAI` / `pollAssemblyAI` in [supabase/functions/transcribe-video/index.ts](supabase/functions/transcribe-video/index.ts)) until AssemblyAI's servers finish processing. No file size limit on AssemblyAI's side.
- **OpenAI's `/v1/audio/transcriptions` is synchronous**: you POST actual audio bytes directly (multipart form), and the transcript comes back in one call — no hosted-URL step, no polling. That means `upload-video`'s entire job (proxy-upload to get a URL) goes away.
- **Consequence**: the file needs to reach `transcribe-video` as bytes some other way — most likely the client uploads the video to Supabase Storage first (this stack already has Storage available), and `transcribe-video` reads it from there before POSTing to OpenAI.
- **File size**: OpenAI's transcription endpoint caps around 25MB per request. AssemblyAI has no such cap. Long lecture videos will likely need audio extraction (this repo already has `ffmpegAudioExtractor.ts` for client-side audio extraction — check whether that gets you under 25MB, or whether chunking/splitting is needed for very long recordings) before this swap is viable end-to-end.
- **Timeout note**: `transcribe-video` currently runs its poll loop inside an `EdgeRuntime.waitUntil` background task, which isn't bound by the 60s HTTP response window, so long AssemblyAI jobs don't time out. A single long synchronous OpenAI call inside that same background task should be fine for the same reason, but hasn't been verified against Deno Deploy's background-task ceiling.
- **Frontend**: [src/lib/videoUploadPipeline.ts](src/lib/videoUploadPipeline.ts) orchestrates `upload-video` → `transcribe-video` and would need its Step 1 rewritten (Storage upload instead of AssemblyAI proxy).

Whoever picks this up: start by confirming whether client-side audio extraction (already implemented) reliably gets lecture-length videos under OpenAI's 25MB cap before committing to the Storage-upload restructure.


## Citation-based analytics (2026-10-24)

The analytics page counts what answers *cited* rather than grouping questions into topics. Migration `20261024120000_citation_analytics.sql` adds the admin-only RPCs and the `query_events.ai_*` label columns; `supabase/tests/citation_analytics.sql` covers them in a rolled-back transaction.

- **Join on `citations.material_id` + `page_number` / `start_ms`–`end_ms`, never `chunk_id`.** Re-processing a material recreates its chunks and sets old `citations.chunk_id` to NULL (`20261009180000`). The older `get_course_document_reference_stats` (used by `analytics-chat`) still joins through `chunks`, so it undercounts re-processed materials.
- **Keyword search** (`course-analytics` → `match_course_chunks_for_analytics`) searches every material of the course regardless of term or access scope, never student documents, admins only. The floor is `KEYWORD_MATCH_THRESHOLD = 0.2` in `_shared/analyticsPlaces.ts`, measured on real notes: covered topics scored 0.37–0.65, a rare covered term 0.24, off-topic words ≤ 0.17. Video chunks within 30 s merge into one place.
- **"Cited" is not "asked about":** an answer can cite a background page. The page says so.
- **Labels** (`_shared/questionLabels.ts`): one Decisions API request per question with three questions (category choice, two predicates; "yes" from probability 0.5). Refusals are saved as NULL with `ai_labeled_at` set, so nothing is re-sent; failed calls are left unlabelled and retried on the next visit. `query_category` (regex) remains the fallback. Labelling runs when an admin opens the page (`useQuestionLabels`), not from `rag-chat`, so no chat path changed and no schedule is needed.
- **Question-first page (2026-10-25):**
  - Migrations `20261025090000_question_analytics.sql` and `20261025120000_question_detail.sql` add four functions:
    - `get_course_question_overview`;
    - `get_course_questions`, a filterable, paged list;
    - `get_course_question_terms` (common words and phrases; the page no longer shows them, but the function is kept);
    - `get_course_question_detail`, which returns the answer text and related questions.
  - They also add `get_course_cited_files` and drop `get_course_questions_at_places`. Tests are in `supabase/tests/question_analytics.sql`.
  - Copies of a file are merged **by file name** (the cited-files list, answer sources, related questions). Two different files with the same name in one course would also merge.
  - Terms are computed per request with Postgres text search: one `to_tsvector` pass over the course's chunks, about 20 ms on the local test course. A topics list was tried in the left pane and removed: next to the search box it looked like search was scoped to it.
  - "Not from materials" is the Decisions API label when one exists. Unlabelled questions count when their answer cited nothing.
- The Decisions API has no AI SDK binding: `_shared/decisions.ts` is a small fetch client (retries 429/5xx), exposed through `llm.ts#createOpenAIDecisionsClient`. Only `gpt-6-luna` is supported.

## Student chat telemetry (2026-10-22)

`query_events` now stores one best-effort terminal event for each authenticated, valid student-chat request, including errors and client aborts. Earlier authentication/configuration/JSON failures remain in function logs. `request_id` is server-generated and unique; course/conversation IDs are populated only after access resolution. Hard runtime termination or a failed telemetry write can still leave no event.

- `outcome = success` means the final SSE answer was delivered. A later message-save failure keeps that outcome and sets `error_code = message_persistence_failed`. Existing usage analytics exclude errors, aborts, and these persistence failures; historical rows default to success with unknown telemetry fields.
- `latency_ms` ends at final delivery for successful answers, or at failure/abort. `first_token_ms` measures the first nonempty text sent, including text later cleared by a tool-call reset. The monotonic clock starts after authentication and valid message parsing.
- `generation_ms` measures the answer-generation block, including agent searches and fallback turns. `embedding_ms` and `retrieval_ms` sum actual search work, even failed phases; concurrent searches can overlap. These timings are not additive. Citation repair, video-evidence selection, and message persistence are outside `generation_ms`.
- The custom Chat Completions provider sets `compatibility: "strict"`; AI SDK v4 otherwise omits streaming usage.
- Token totals cover all chat-model steps, retries, citation repair, and video-evidence selection, including fast-model evidence selection on smart/pro requests. `model_id`/`model_tier` identify the answer model. Embedding tokens are excluded. Missing/failed call usage makes the affected token total NULL, not zero or an undercount.
- `analytics_course_chat_health` uses UTC daily buckets and invoker security over admin-only event RLS. It excludes legacy rows without request IDs; latency averages/p95 use successes, and error rate is errors / (successes + errors). Aborts and persistence errors have separate counts. `known_usage_count` shows token-total coverage. Do not average daily p95 values to obtain a multi-day p95.
- Migration `20261021120000` was applied and recorded through the Management API after a rollback preview. Hosted history was partially tracked (6 entries before this migration), not empty. Inspect current history before any `db push`.
- Deploy both `rag-chat` and `analytics-chat` when changing the streaming return shape. Validation lives in `_shared/{chatTelemetry,llmUsage,llmStreaming}.test.ts`, `rag-chat/index.test.ts`, and `supabase/tests/chat_telemetry.sql` (transactional rollback).
