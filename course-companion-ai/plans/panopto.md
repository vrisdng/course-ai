# Panopto Link Import + Timestamped RAG Integration

## Summary

Implement a new course-material flow where a lecturer pastes a Panopto session link, your system resolves the session under end-user auth, ingests transcript/captions when available, falls back to your own transcription when captions are unavailable, embeds transcript chunks into `chunks`, and lets students ask questions about the video as if it were any other course material.

Default UX and policy locked in for this plan:
- Playback UX: in-app embedded Panopto player at cited timestamp, with `Open in Panopto` fallback.
- Auth model: end-user Panopto auth.
- Transcript access policy: once imported into a course, course-enrolled users in your app can query the transcript.
- Missing captions policy: attempt your own transcription fallback.
- Scope: course-material imports only, not student-private uploads.

### Feasibility weighting

- **Scenario A: OAuth/API access works, captions exist**: `8/10`
  - Strong feasibility. This is mainly an import + indexing + embed-player feature.
- **Scenario B: OAuth/API access works, captions missing, but media/audio can be fetched for fallback transcription**: `6/10`
  - Still feasible, but now depends on media retrieval, transcription cost, and longer processing.
- **Scenario C: OAuth/API access works, captions missing, but media/audio cannot be programmatically fetched**: `3/10`
  - RAG import is blocked for captionless videos.
- **Scenario D: tenant/API registration or OAuth app access is unavailable**: `2/10`
  - Reliable Panopto integration is not viable; only public/manual workflows remain.

### Source-backed constraints that drive this plan

Based on Panopto employee answers in Panopto’s official community:
- Public REST can return a session caption download link when captions exist and the user has permission: [Panopto Community, 2021](https://community.panopto.com/discussion/1317/programmatic-access-to-transcript-or-closed-caption-text).
- Caption download may require exchanging the OAuth token for an auth cookie via `LegacyLogin` for some caption URLs: [Panopto Community, 2022](https://community.panopto.com/discussion/1481/api-access-to-caption-file).
- OAuth access is limited to the logged-in user’s permissions, not system-wide: [Panopto Community, 2023](https://community.panopto.com/discussion/2074/rest-api-key-secret-limited-to-specific-folders-sessions-something).
- Public REST does not currently expose full caption-track listing cleanly; internal APIs are unsupported: [Panopto Community, 2024](https://community.panopto.com/discussion/2506/api-endpoint-to-list-caption-tracks-for-a-specific-session).
- Sessions API is still the main way to resolve metadata/caption-link behavior: [Panopto Community, 2024](https://community.panopto.com/discussion/2548/getting-session-id-from-delivery-id).

This means the plan must treat Panopto transcript access as permission-sensitive and tenant-sensitive.

---

## Product Behavior

## User flow

1. Lecturer opens course materials UI.
2. Lecturer pastes a Panopto link instead of uploading a file.
3. App prompts Panopto sign-in if not already connected.
4. Backend resolves the Panopto session and validates access.
5. Backend tries transcript import path first:
   - fetch session metadata
   - obtain caption/transcript artifact if available
6. If transcript is unavailable:
   - attempt media/audio retrieval
   - run your own transcription provider
7. Store normalized timestamped transcript.
8. Chunk transcript into RAG chunks with `start_ms/end_ms`.
9. Students can ask questions against the imported video.
10. Citations show time ranges like `03:10-03:42`.
11. Clicking a citation opens an embedded Panopto player at that range, with fallback link-out.

## Student-visible behavior

- Imported Panopto videos behave like course materials in retrieval.
- Students do not need to know whether the transcript came from Panopto captions or your fallback transcription.
- If playback fails because Panopto denies access, the transcript-backed citation remains visible, but the player area must show a clear permission error and an `Open in Panopto` fallback.

---

## Architecture Decision

Build this as a **Panopto import pipeline**, not as a file-upload variant.

Do not download Panopto videos into your own long-term storage for playback.
Do not proxy-stream Panopto video through your backend.

Instead:
- Panopto remains the playback host.
- Your app stores:
  - session metadata
  - transcript segments
  - transcript-derived `chunks`
  - optional lightweight transcript artifacts
- Your app embeds or links to Panopto for playback.

---

## Data Model Changes

## 1. Extend `document_type`
Add:
- `video_external`

Reason:
- Distinguish an external hosted video from uploaded `video` files if you also keep native uploads later.
- If you prefer fewer enum values, `video` can be reused, but this plan assumes `video_external` to avoid conflating Panopto imports with uploaded media.

## 2. Extend `materials`
Add:
- `external_provider text null`  
  Values in v1: `panopto`
- `external_id text null`  
  Panopto session/delivery identifier used for API lookups
- `external_url text null`
- `embed_url text null`
- `duration_ms bigint null`
- `transcription_provider text null`
- `transcription_language text null`
- `transcript_source text null`  
  Values in v1: `panopto_captions`, `fallback_transcription`
- `import_source text null`  
  Values in v1: `upload`, `panopto_link`

Keep using:
- `processing_status`
- `processing_error`

## 3. New table: `material_transcript_segments`
Columns:
- `id uuid primary key default gen_random_uuid()`
- `material_id uuid not null references public.materials(id) on delete cascade`
- `segment_index integer not null`
- `start_ms bigint not null`
- `end_ms bigint not null`
- `text text not null`
- `confidence numeric null`
- `speaker_label text null`
- `source text not null`  
  `panopto_captions` or `fallback_transcription`
- `created_at timestamptz not null default now()`

Indexes:
- `(material_id, segment_index)`
- `(material_id, start_ms)`

## 4. Extend `chunks`
Add:
- `start_ms bigint null`
- `end_ms bigint null`

Keep `page_number` for document materials.

Interpretation:
- document chunk: `page_number` populated
- transcript/video chunk: `start_ms/end_ms` populated

## 5. New auth-token table for end-user Panopto connection
Create `user_external_accounts` or provider-specific equivalent.

Recommended generic shape:
- `id uuid primary key`
- `user_id uuid not null`
- `provider text not null`  
  `panopto`
- `tenant_host text not null`
- `access_token_encrypted text not null`
- `refresh_token_encrypted text null`
- `token_expires_at timestamptz null`
- `external_user_id text null`
- `created_at timestamptz`
- `updated_at timestamptz`

Add unique index on:
- `(user_id, provider, tenant_host)`

Reason:
- End-user auth requires token storage/refresh for background import actions.

---

## Backend Services

## 1. New Edge Function: `connect-panopto`
Purpose:
- complete OAuth callback/token exchange
- store encrypted end-user Panopto tokens

Inputs:
- OAuth code + state
- resolved tenant host

Outputs:
- success + account linkage metadata

## 2. New Edge Function: `import-panopto-session`
Purpose:
- import a Panopto link into `materials`
- fetch transcript if possible
- fallback to self-transcription if not
- write transcript segments + chunks

Request body:
```json
{
  "courseId": "uuid",
  "academicTermId": "uuid",
  "accessScope": "course",
  "panoptoUrl": "https://tenant.panopto.com/Panopto/Pages/Viewer.aspx?id=...",
  "titleOverride": null
}
```

Responsibilities:
1. Authenticate app user and verify lecturer/admin role.
2. Resolve linked Panopto account for that user and tenant.
3. Parse the pasted URL into normalized Panopto identifiers.
4. Resolve the session via Panopto API.
5. Create `materials` row with `import_source='panopto_link'`, `external_provider='panopto'`, `file_type='video_external'`.
6. Try transcript import path:
   - fetch session metadata
   - inspect caption availability from session payload
   - if needed call `LegacyLogin` to get cookie-backed caption access
   - download caption/transcript artifact
   - normalize into timestamped segments
7. If transcript import fails because captions are unavailable:
   - attempt media/audio retrieval path
   - if media/audio retrieval works, call transcription provider
   - normalize returned segments
8. Store transcript metadata and segments.
9. Build transcript chunks.
10. Generate embeddings and insert `chunks`.
11. Mark `materials.processing_status='completed'`.
12. On failure, set `failed` with actionable `processing_error`.

## 3. New internal module: `panoptoClient`
Responsibilities:
- tenant host normalization
- URL parsing
- session lookup
- caption retrieval
- optional legacy-login cookie exchange
- embed URL generation
- timestamp URL generation

Important:
- never use Panopto internal unsupported APIs
- only use documented/public APIs and supported auth flows

## 4. New internal module: `transcriptionProvider`
Responsibilities:
- fallback transcription only when Panopto captions are unavailable
- provider abstraction similar to:
  - `transcribeAudio(input) -> normalized segments`
- v1 implementation:
  - Whisper-compatible API

## 5. New internal module: `transcriptChunker`
Responsibilities:
- aggregate transcript segments into retrieval chunks
- preserve chronology
- compute `start_ms/end_ms` per chunk

Defaults:
- target chunk size: `1200` chars
- overlap: `1` transcript segment
- minimum useful chunk size: `200` chars when possible

---

## Panopto Scenarios And Handling

## Scenario A: API access works and captions are available
Behavior:
- import captions directly
- no self-transcription
- fastest path
- highest fidelity to Panopto timing

Expected result:
- `transcript_source='panopto_captions'`

## Scenario B: API access works but captions are unavailable
Behavior:
- attempt fallback transcription

Subcase B1: media/audio retrievable
- transcribe ourselves
- continue import

Subcase B2: media/audio not retrievable
- fail import with explicit error:
  - “Panopto captions are unavailable and this tenant/session does not permit fallback media transcription.”

Expected result:
- success path uses `transcript_source='fallback_transcription'`
- failure path marks material `failed`

## Scenario C: OAuth/API client setup not available in tenant
Behavior:
- block import before material creation or mark failed immediately
- UX message:
  - “This Panopto tenant has not enabled the required API integration for end-user import.”

No workaround in v1 except:
- later manual transcript import flow
- institution-level setup

---

## Frontend Changes

## 1. New Panopto import form
In the lecturer/admin materials UI:
- add “Import from Panopto” entry point beside file upload
- fields:
  - Panopto URL
  - course
  - academic term
  - access scope

Behavior:
- if no linked Panopto account:
  - prompt “Connect Panopto”
- after submission:
  - create import job via `import-panopto-session`
  - show progress / pending / failed states using existing material processing UI

## 2. Material list support
Recognize `video_external` materials.
Display:
- provider badge `Panopto`
- duration if known
- transcript source if useful in admin UI
- status `processing/completed/failed`

## 3. Citation rendering
Extend citation type:
- `startMs?: number`
- `endMs?: number`
- `sourceKind?: 'document' | 'video'`

For video citations:
- render label as `03:10-03:42`
- still show source name as session title

## 4. Citation click behavior
Primary action:
- open an in-app modal or side panel with embedded Panopto player at the cited start time

Fallback behavior:
- if embed fails or user is unauthorized, show:
  - permission/error state
  - `Open in Panopto` button

Do not attempt to proxy the stream yourself.

## 5. Chat source panel
Update source panel for videos:
- show:
  - video title
  - time range
  - transcript excerpt
- provide both:
  - `Play Here`
  - `Open in Panopto`

---

## Retrieval And RAG Changes

## 1. `match_chunks`
Extend function output to return:
- `start_ms`
- `end_ms`

Do not remove `page_number`.

## 2. `rag-chat`
Update retrieval result types and citation payload generation so citations can carry time ranges.

Citation payload shape:
```json
{
  "id": "citation-1",
  "chunkId": "uuid",
  "excerpt": "...",
  "documentName": "Lecture 5",
  "documentType": "video_external",
  "startMs": 190000,
  "endMs": 222000,
  "relevanceScore": 0.88
}
```

## 3. Citation/source label formatting
For transcript/video chunks:
- prefer time-range label
- format:
  - `MM:SS-MM:SS` under 1 hour
  - `HH:MM:SS-HH:MM:SS` otherwise

## 4. Prompt/source context
When constructing source labels for transcript chunks, include time range instead of page:
- `Lecture 5 Recording (03:10-03:42)`

No other prompt redesign is necessary.

---

## Playback / Embed Design

## 1. Embedded player
Use Panopto-supported embed URL format if available from the session metadata or a deterministic helper.
Pass the starting timestamp when possible.

## 2. Fallback link
Always store and expose the canonical Panopto session URL.
If embed timestamp parameters are brittle, compute:
- embed start parameter if supported
- otherwise canonical viewer URL with the nearest supported time parameter
- final fallback: open the session and rely on Panopto navigation

## 3. Auth behavior
Because this is end-user auth:
- the embedded player will only work if the student also has Panopto access
- transcript chat access in your app remains course-enrollment based per the chosen policy

This asymmetry is intentional in v1 and must be documented in UX copy.

---

## Security And Permissions

## App-side authorization
- Only lecturer/admin can import Panopto sessions into course materials.
- Imported transcript becomes visible to course-enrolled users in your app.
- This is independent from Panopto playback permission.

## Panopto-side authorization
- All API access is done using the importing user’s Panopto OAuth identity.
- Do not use admin-wide service tokens in v1.
- Access to import is limited by what that user can access in Panopto.

## Token storage
- Encrypt Panopto refresh/access tokens at rest.
- Scope tokens per tenant host.
- Add refresh-on-use logic in the Panopto client.

---

## Important Changes To Public APIs / Interfaces / Types

## New Edge Functions
- `connect-panopto`
- `import-panopto-session`

## New / changed DB schema
- `document_type += 'video_external'`
- `materials.external_provider`
- `materials.external_id`
- `materials.external_url`
- `materials.embed_url`
- `materials.duration_ms`
- `materials.transcription_provider`
- `materials.transcription_language`
- `materials.transcript_source`
- `materials.import_source`
- `chunks.start_ms`
- `chunks.end_ms`
- new `material_transcript_segments`
- new token/account linkage table for external providers

## Updated frontend types
- citation types gain `startMs/endMs`
- material type support for `video_external`
- source-opening logic supports video transcript citations

---

## Implementation Phases

## Phase 1: Foundation
1. Add schema changes and regenerate Supabase types.
2. Extend `match_chunks`.
3. Add frontend support for timestamp metadata on citations.

## Phase 2: Panopto auth + session import
1. Implement Panopto OAuth connection flow.
2. Add token storage and refresh logic.
3. Add Panopto URL parsing and session resolution.
4. Build the lecturer/admin “Import from Panopto” UI.

## Phase 3: Captions-first transcript ingestion
1. Implement caption retrieval using Panopto-supported APIs.
2. Normalize captions to `material_transcript_segments`.
3. Build transcript chunker and embed into `chunks`.
4. Surface timestamp citations in chat.

## Phase 4: Embedded playback
1. Build in-app embedded Panopto player modal/panel.
2. Add `Open in Panopto` fallback.
3. Add permission-failure states.

## Phase 5: Self-transcription fallback
1. Implement media/audio retrieval path if supported by session/tenant rules.
2. Add Whisper-compatible transcription adapter.
3. Normalize fallback transcript to the same segment schema.
4. Mark transcript source accordingly.

## Phase 6: Hardening
1. Retry/backoff for Panopto API and transcription provider.
2. Idempotent re-import behavior:
   - clear old transcript segments and chunks before reinserting
3. Better failure classification and admin-facing errors.
4. Telemetry for import success/failure and transcript source mix.

---

## Failure Modes And Handling

- **Panopto tenant not configured for OAuth app**
  - fail early with setup message
- **User connects Panopto but lacks permission for pasted session**
  - fail import with permission message
- **Session exists but captions missing**
  - enter fallback transcription path
- **Captions missing and media retrieval unavailable**
  - fail with explicit “cannot import transcript from this session”
- **Transcript imported but embedded player unauthorized for student**
  - chat still works
  - citation player shows access error + fallback button
- **Session removed/permission changed later in Panopto**
  - imported transcript remains in your app unless you add a later sync/revalidation job
  - playback may stop working
- **Duplicate imports of same session into same course**
  - default behavior: dedupe by `external_provider + external_id + course_id`
  - if already imported, update/reindex existing material instead of creating a duplicate

---

## Test Cases And Scenarios

## Unit tests
- Panopto URL parser handles supported viewer/embed URL variants
- timestamp formatter outputs correct labels
- transcript chunker preserves segment order and computes correct `start_ms/end_ms`
- citation model renders video citations distinctly
- dedupe key generation for Panopto imports is stable

## Integration tests
- OAuth connection stores tenant-scoped token linkage
- importing a Panopto link creates or updates a `materials` row
- captions-first path writes:
  - `material_transcript_segments`
  - `chunks` with timestamps
- `rag-chat` returns citations with `startMs/endMs`
- clicking citation builds correct embed/open URLs

## Scenario tests
1. Captions available:
   - import succeeds without fallback transcription
2. Captions missing, fallback transcription available:
   - import succeeds with `transcript_source='fallback_transcription'`
3. Captions missing, fallback unavailable:
   - import fails cleanly
4. Student has course enrollment but no Panopto viewing permission:
   - chat works
   - player embed fails with permission state
5. Re-import same Panopto link:
   - existing material is reindexed, not duplicated

## Manual acceptance criteria
- Lecturer can paste a Panopto link and import it into a course
- Students can ask video-specific questions and get timestamp citations
- Citation click opens embedded player at cited time or falls back to Panopto
- Processing failures are actionable and distinguish:
  - auth problem
  - no captions
  - no fallback media access
  - transcription provider error

---

## Assumptions And Defaults

- Panopto tenant supports registering the OAuth client needed for end-user access.
- End-user OAuth is available for your institution’s Panopto deployment.
- Public/internal unsupported Panopto APIs will not be used.
- Imported transcript visibility follows your app’s course enrollment, not Panopto view permission.
- Playback permission may still differ from transcript-query permission in v1.
- Missing captions should trigger self-transcription fallback if media/audio retrieval is permitted.
- Panopto remains the playback host; your app does not proxy or restream video.
- v1 only supports course-material imports, not student-private Panopto imports.
