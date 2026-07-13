# course-companion-ai

An AI course-companion app: students chat with a RAG-powered assistant over course materials (documents, slides, videos); admins manage courses, materials, enrollment, and view analytics. React + Vite + TypeScript frontend, Supabase (Postgres/pgvector + Edge Functions) backend, OpenAI + Gemini for chat/embeddings, AssemblyAI for video transcription.

> Time-sensitive/dynamic behaviors (expiries, TTLs, retry windows, rate windows) are called out inline with a ⏱ marker, and summarized in the [table at the bottom](#-dynamic-time-based-behavior-reference).

## Roles & access

Two roles only: `student` and `admin` (a `lecturer` role existed historically and was merged into `admin`; some function names like `is_course_lecturer` still exist as compatibility aliases for `is_admin`).

- **Students**: chat with course materials, manage their own conversations, set personal custom instructions.
- **Admins**: everything students can do, plus manage courses/terms/materials, invite/enroll students, view analytics.

Route guarding is via `ProtectedRoute` — unauthenticated users are sent to `/auth`; authenticated users lacking the required role are redirected to `/admin-dashboard` (if admin) or `/chat` (otherwise), not shown a 403 page.

Course-level access uses two mechanisms together:
- `enrollments` — canonical enrollment record.
- `profiles.course_enrolled` — a denormalized array cache of enrolled course IDs, kept in sync by trigger, used for fast checks in the auth context.

Each material also carries a `material_access_scope`: `course` (enrolled students + admins), `public` (any authenticated user), or `private` (uploader only). This scope is enforced both in RLS and inside the RAG retrieval function.

## Authentication

Email + password only — no OAuth/social login, no magic-link-only flow. Password minimum 6 characters.

- Sign-up triggers Supabase's built-in email confirmation, supporting **both** a clickable email link and a 6-digit OTP code entered in-app.
- Invite-aware: a `?invite=<code>` query param on the auth page is preserved through sign-in/sign-up and forwarded after login so the invite/course-code redemption flow can pick it up.
- Session handling relies entirely on the Supabase JS client's default token refresh — no custom session TTL logic in this app.
- Post-login redirect: admins → `/admin-dashboard`, students → `/chat` (or back to wherever `ProtectedRoute` redirected them from).

## Student chat (RAG)

The core feature: `/chat/:conversationId?`, backed by the `rag-chat` edge function.

**Model tiers** — user-selectable per message, default `Fast`:

| Tier | Model | Provider |
|---|---|---|
| Fast | `gpt-4o-mini` | OpenAI |
| Smart | `gemini-2.5-flash` | Gemini (OpenAI-compatible endpoint) |
| Pro | `gemini-2.5-pro` | Gemini (OpenAI-compatible endpoint) |

**Retrieval**: query is embedded with `gemini-embedding-001`, matched against course material chunks with a high-recall first pass (top 18, similarity ≥ 0.50), then reranked down to a final 10 results (relevance floor 0.55, relaxed to 0.40 for broad "summary" queries). Retrieval is automatically scoped to:
- the course(s) the student is asking about,
- ⏱ **the currently active academic term** — switching the active term instantly changes what the assistant can see, app-wide (see [Academic terms](#academic-terms--course-management)),
- the student's chosen document scope (see below).

**Document scope**: students can select which materials to include. Selecting "all" sends no filter (search everything in scope); selecting **zero** documents skips retrieval entirely and the assistant answers from the conversation alone.

**Citations**: the model emits inline `<<cite:N>>` tokens referencing a numbered source list injected into the prompt; a second pass can add citations to a draft answer that's missing them. Each citation stores the source chunk, a relevance score, and a 300-character excerpt. ⏱ Citation source-preview links use signed URLs valid for **120 seconds**.

**Conversation history**: ⏱ up to the last 24 messages are fetched, tail-limited to the last 14 turns, each message clipped to 850 characters, and the whole window capped at a 9000-character budget before being sent to the model.

**Conversation limits**: none — a per-user conversation cap existed at one point and was explicitly removed; users can create unlimited conversations.

**Custom instructions**: students can set free-text personal instructions in Settings, which are injected into the system prompt on every one of their chat requests (RAG and non-RAG paths alike) for persistent, cross-conversation personalization.

**Flashcard generation**: from any assistant answer, generate 3–10 flashcards (`gemini-3-flash-preview`) sized to the amount of context available (grows with cited-source length, capped at 10). Built from the answer plus up to 6 cited source chunks. No retry on rate-limit — a 429 from Gemini surfaces directly as an error toast.

## Materials

Admins upload course materials in two pipelines, both async and job-tracked.

### Documents (PDF, DOC/DOCX, PPTX, images)

- ⏱ **15 MB** size limit (Gemini inline-vision constraint).
- Supported: `pdf, png, jpg, jpeg, webp, gif, doc, docx, pptx`. Not supported: legacy `.ppt`, `.xls`/`.xlsx`.
- `docx`/`pptx` are parsed directly from their XML (no AI call); `pdf`/images/`doc` go through Gemini Vision for text extraction.
- Upload enqueues a `material_processing_jobs` row and fires the worker; extraction happens off the upload request.
- ⏱ Runs inside Supabase's default **60-second** edge function timeout — large PDFs (30+ pages) risk timing out.
- Extracted text is chunked (⏱ 1200 chars/chunk, 200-char overlap, ~1000-char step) and embedded, ⏱ up to 3 retry attempts per embedding call.
- ⏱ Hard caps: 500,000 characters of extracted text, and 250 chunks per document — documents exceeding either are rejected rather than silently truncated.

### Video

- Supported: `.mp4`, `.webm` only.
- ⏱ **5 GB** size limit (AssemblyAI's own limit); ⏱ files over **200 MB** trigger a "this may take a while" confirmation before upload.
- Uploaded video streams directly from the browser through an edge function straight to AssemblyAI — never buffered or stored in Supabase Storage.
- Transcription is polled ⏱ every 5 seconds until AssemblyAI reports done/failed (no client-side timeout on the poll loop — it waits as long as AssemblyAI takes).
- Upload progress shown to the user is **cosmetic**: an eased animation from 0%→85% over a fixed ⏱ 60 seconds, not driven by real network progress.
- Note: a client-side FFmpeg-based audio extractor/chunker (`src/lib/ffmpegAudioExtractor.ts`) exists in the codebase but is not called from anywhere — leftover from an earlier design, not part of the live pipeline.

### Processing jobs — retry & recovery

Materials processing runs as claimed jobs with automatic recovery:

- ⏱ A job is considered **stale** if it's been "processing" for more than **5 minutes** without progress — it's automatically reset to `pending` for another worker to pick up.
- ⏱ A job gets **5 attempts** total; once `attempt_count` reaches 5 it's marked permanently `failed` (and the parent material's status follows suit) rather than retried again.
- A scheduled reaper job performs this stale-detection/failure-propagation sweep and also nudges a batch of pending jobs forward.

## Academic terms & course management

Admins manage courses and academic terms (e.g. "Semester 2 AY25/26").

- ⏱ **Exactly one term is active at a time**, enforced at the database level — activating a new term is a manual admin action, not date-driven (the schema has optional start/end date columns, but they aren't currently used to auto-switch terms).
- New material uploads are automatically stamped with whichever term is active at upload time.
- Because RAG retrieval filters by active term, **switching the active term is an instant, course-wide change** to what the chatbot can answer from — worth being deliberate about in production.

### Course invites & enrollment

Two ways to get a student into a course, both admin-only to create, both on the same `course_invites` table:

1. **Per-email invites** — up to 200 per request; checks each address for existing enrollment/invite/validity before creating.
2. **Course-join codes** — a single reusable 8-character code (unambiguous charset, no `0/O/1/I`) shared course-wide.
   - ⏱ Regenerating a course's code **immediately invalidates every previous code** for that course.

⏱ **Both invite types expire 30 days after creation.** Redemption checks the expiry and rejects with "Invite has expired" past that window; only course-join codes go through the redemption endpoint (per-email invites are a separate accept path). Redemption is idempotent — redeeming an already-enrolled invite just confirms enrollment rather than erroring.

## Admin analytics

`/admin-analytics` — per-course usage metrics: enrolled students, active students, document count, total questions asked, most-referenced documents, top questions asked, and keyword frequency (English stopwords filtered, top 20 keywords).

- ⏱ **Default date range is the last 30 days**, computed from "now" — not a fixed calendar window. Admins can pick an arbitrary custom start/end range; the "reset" control re-anchors back to "now minus 30 days" rather than restoring a fixed default.
- Top-questions and keyword-frequency results are hard-capped server-side (max 10 questions, max 20 keywords) regardless of what the client requests.
- A separate **analytics chat** feature lets admins ask natural-language questions over this same analytics data (its own chat model/endpoint, distinct from student RAG chat).

## Settings

Students and admins can update their profile and set **custom instructions** (see [Student chat](#student-chat-rag)) that shape the assistant's tone/behavior across all their future conversations.

---

## Tech stack

- **Frontend**: React 18, Vite, TypeScript, React Router, TanStack Query, Tailwind CSS, shadcn/ui (Radix primitives).
- **Backend**: Supabase — Postgres with pgvector, Row Level Security, Edge Functions (Deno).
- **AI/ML**: OpenAI (`gpt-4o-mini`), Gemini (`2.5-flash`, `2.5-pro`, `gemini-embedding-001`, `gemini-3-flash-preview` for flashcards), AssemblyAI (video transcription).

## Local development

```sh
npm i
npm run dev      # dev server on :8080
npm run build
npm run test      # vitest
npm run lint
```

Requires a `.env` with Supabase project credentials and provider API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ASSEMBLY_API_KEY`, `RESEND_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `VITE_SUPABASE_*`). See [HANDOFF.md](HANDOFF.md) for known issues, including an important note about secret rotation.

## ⏱ Dynamic/time-based behavior reference

| Feature | Behavior | Type |
|---|---|---|
| Course invite / join code | Expires 30 days after creation | Fixed TTL |
| Course code regeneration | Invalidates all prior codes for that course immediately | Instant invalidation |
| Active academic term | Exactly one active at a time; admin-toggled, not date-driven; instantly changes RAG retrieval scope | Manual switch |
| Conversation history sent to model | Last 24 messages fetched → last 14 turns → 850 chars/message → 9000-char total budget | Rolling window |
| Conversation count per user | Unlimited (cap removed) | N/A |
| Citation source preview link | Signed URL valid 120 seconds | Fixed TTL |
| Document upload size | 15 MB max | Fixed limit |
| Video upload size | 5 GB max; 200 MB triggers a confirmation prompt | Fixed limit |
| Document text/chunk limits | 500,000 chars max, 250 chunks max per document | Fixed limit |
| Embedding call retries | Up to 3 attempts | Fixed retry count |
| Material processing job — stale detection | Reset to pending after 5 minutes stuck "processing" | Fixed timeout |
| Material processing job — max retries | Marked permanently failed after 5 attempts | Fixed retry count |
| Video transcription polling | Polled every 5 seconds until AssemblyAI resolves (no max wait) | Fixed interval, unbounded wait |
| Video upload progress bar | Cosmetic animation 0%→85% over a fixed 60 seconds | Simulated, not real progress |
| Admin analytics default range | Last 30 days from "now"; "reset" re-anchors to current time | Rolling window |
| Flashcard count generated | 3–10 cards, scaled by available source context | Dynamic, content-driven |
