# Gemini Vision API — Usage & Constraints

Reference documentation for how this project uses the Google Gemini API for document text extraction and embedding generation.

> **2026-09-21:** PDF and image OCR moved to **OpenAI `gpt-5.6-luna`** (file/image parts inline, via `_shared/llm.ts#generateDocumentText`), so the deployed Gemini key no longer gates ingestion of the common formats. Gemini Vision now handles only legacy `.doc`; embeddings are unchanged. The page-range/resume/backoff mechanics described below apply to both providers. Measured on the same 47-page deck: luna 8 pages in 27 s, all 47 in 85 s; identical text for the first 8 pages whether asked for a range or the whole document.

---

## 1. API Endpoint & Model

| Purpose | Endpoint | Model |
|---------|----------|-------|
| **Text extraction (Vision)** — legacy `.doc` only | `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent` | `gemini-3.8-flash` |
| **Text extraction** — PDF + images | OpenAI chat completions via `_shared/llm.ts` | `gpt-5.6-luna` |
| **Embeddings** | `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent` | `gemini-embedding-001` |

Both are called from the `process-material-job` edge function (queued by `parse-document`) using the `GEMINI_API_KEY` secret. The pure helpers (prompt, base64, page-range planning, retry) live in `supabase/functions/_shared/extraction.ts` and are unit tested.

---

## 2. How We Use It — Text Extraction

We send files to Gemini's multimodal `generateContent` API using the **base64 inline data** approach:

```json
{
  "contents": [{
    "parts": [
      { "text": "Extract ALL text content from this document verbatim..." },
      { "inlineData": { "mimeType": "application/pdf", "data": "<base64>" } }
    ]
  }],
  "generationConfig": {
    "temperature": 0,
    "maxOutputTokens": 65536
  }
}
```

### Extraction prompt
The system prompt instructs Gemini to preserve structure (headings, lists, tables, formulas) and return **only** raw text — no summaries or commentary. For PDFs longer than 16 pages the prompt is scoped to a page range (`pages A to B`, labelled with the document's real page numbers) and the whole file is sent each time; see §5.

### Temperature
Set to `0` for deterministic, faithful text extraction. This minimizes hallucination and ensures consistent output across retries.

---

## 3. Supported MIME Types

### Gemini Vision (PDF, images, and legacy DOC best-effort)

| Extension | MIME Type | Notes |
|-----------|-----------|-------|
| `.pdf` | `application/pdf` | Native support, up to ~100 pages |
| `.png` | `image/png` | OCR for scanned/handwritten content |
| `.jpg` / `.jpeg` | `image/jpeg` | OCR for scanned/handwritten content |
| `.webp` | `image/webp` | Supported |
| `.gif` | `image/gif` | Supported (first frame for animated) |
| `.heic` / `.heif` | `image/heic` | Supported by Gemini but not used in our upload UI |
| `.doc` | `application/msword` | Legacy binary format — best-effort via Gemini, results may vary |

### Handled via XML parsing (no API call)

| Extension | Method | Notes |
|-----------|--------|-------|
| `.docx` | ZIP → `word/document.xml` → extract `<w:t>` tags | No Gemini API call needed |
| `.pptx` | ZIP → `ppt/slides/slide*.xml` → extract `<a:t>` tags | Slide numbers preserved |

### Not supported

| Extension | Reason |
|-----------|--------|
| `.ppt` | Legacy binary format — not implemented |
| `.xls` / `.xlsx` | Not implemented (could be added via XML parsing) |

---

## 4. Constraints & Limits

### Free Tier (Google AI Studio API key)

> ⚠️ Measured 2026-09-21: on the free tier this project's key was limited to **5 RPM per model** (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`) and received `503 UNAVAILABLE "high demand"` on every model, including plain text requests, because free traffic is shed first under load. Billing was enabled that day; the project is now on the paid tier and the burst test went 30/30 with no 429/503. The numbers below are Google's published free-tier figures, kept for reference.

| Constraint | Limit |
|------------|-------|
| Requests per minute (RPM) | 15 (measured: 5 on `gemini-3.8-flash`) |
| Requests per day (RPD) | 1,500 |
| Tokens per minute (TPM) | 1,000,000 |
| Max inline data size | ~20 MB base64 (~15 MB raw file) |
| Max output tokens (per request) | 65,536 |
| Max PDF pages (recommended) | < 50 pages for reliability |
| Max PDF pages (hard limit) | ~100 pages |

### Pay-as-you-go Tier

| Constraint | Limit |
|------------|-------|
| Requests per minute (RPM) | 2,000 |
| Requests per day (RPD) | Unlimited |
| Tokens per minute (TPM) | 4,000,000 |
| Max inline data size | Same as free tier |

### Embedding API (`gemini-embedding-001`)

| Constraint | Limit |
|------------|-------|
| RPM (free tier) | 1,500 |
| RPD (free tier) | 10,000 |
| Output dimensionality | 1,536 (configurable) |
| Task type used | `RETRIEVAL_DOCUMENT` |

---

## 5. Large File Handling

- **Hard limit**: Files over **15 MB** raw are rejected before sending to Gemini (the 20 MB base64 ceiling would be exceeded).
- **Page-range extraction** (`process-material-job`): `pdf-lib` counts the pages (<100 ms even for a 5 MB deck). PDFs of ≤16 pages are extracted in one call. Longer PDFs are extracted 16 pages per call; after each range the segments are saved into the job payload (`payload.extraction`), and once an invocation has used ~70 s the job is requeued and re-invoked so the next run resumes from the next page. A killed or timed-out run therefore loses at most one range, not the whole document. Measured on `gemini-3.8-flash`, paid tier: ~1.4 s/page (47 pages in 89 s as one call; 8 pages in 11 s).
- **Per-call timeout**: every Vision call has a 90 s `AbortSignal.timeout` so a hung request fails the attempt instead of freezing the job.
- **Embedding batching**: chunks are embedded via `batchEmbedContents` (100 per call) in resumable slices of 50 per invocation.

---

## 6. Rate Limiting & Retry Strategy

### Current implementation

1. **Vision text extraction** (`fetchWithRetry` in `_shared/extraction.ts`): `429`, any `5xx` (incl. the `503 "high demand"` shed), and network errors are retried up to 3 times with exponential backoff **2 s → 4 s → 8 s** plus up to 1 s jitter. Aborts (the 90 s per-call timeout) are not retried. After the retry budget the job attempt fails with the last error; the job keeps its `attempt_count` (max 5) and can be re-claimed.

2. **Embedding generation**: unchanged — wait 2 s, retry once, then fail the attempt.

### Remaining recommendations

- Apply the same backoff helper to the embedding calls
- Schedule `reap-stale-jobs` (no `pg_cron` entry exists) so failed/stale attempts are actually retried without an admin click

---

## 7. Edge Function Timeout Considerations

| Document type | Typical processing time | Risk |
|---------------|------------------------|------|
| Single image (OCR) | 3–8 seconds | Low |
| PDF ≤16 pages (one call) | 5–25 seconds | Low |
| PDF >16 pages (page ranges) | ~1.4 s/page across several invocations | Low — resumable |
| DOCX (any size) | 1–3 seconds | Very low (no API call) |
| PPTX (any size) | 1–5 seconds | Very low (no API call) |

Supabase Edge Runtime limits (hosted): **150 s wall clock per worker on the free plan (400 s paid), 2 s CPU time per request, 256 MB memory**. Before page-range extraction a single full-document call on a 47-page deck took 89–125 s on the paid tier and never returned within 290 s on the free tier, which is how jobs ended up frozen at "extracting".

---

## 8. Image OCR Quality Notes

- Gemini provides strong OCR for **printed text** in images and scanned PDFs.
- **Handwritten text** quality varies — legible handwriting works reasonably well.
- **Low-resolution images** (<150 DPI) may produce unreliable results.
- **Complex layouts** (multi-column, overlapping text) may lose structure.
- For best results with scanned documents, use **300 DPI** or higher.

---

## 9. Cost Breakdown

### Per document (Vision API)

| Item | Cost (free tier) | Cost (pay-as-you-go) |
|------|------------------|---------------------|
| Vision API call | Free | ~$0.075 per 1M input tokens |
| Typical PDF (~20 pages) | Free | ~$0.005–0.01 |

### Per document (Embedding API)

| Item | Cost (free tier) | Cost (pay-as-you-go) |
|------|------------------|---------------------|
| Embedding per chunk | Free | ~$0.00001 per 1K tokens |
| Typical PDF → 30 chunks | Free | ~$0.0004 |

### Total per document (pay-as-you-go)

A typical 20-page PDF costs approximately **$0.005–0.01** total.

---

## 10. Error Handling Reference

| Error | HTTP Status | Cause | Action |
|-------|-------------|-------|--------|
| Rate limit exceeded / unavailable | `429` / `503` | Quota or Google-side load shedding | Retried with backoff (3×); attempt marked `failed` if all retries fail |
| Payload too large | `413` | File exceeds inline data limit | Reject with message to split document |
| No text extracted | N/A | Gemini returned empty response | Material marked `failed` with error |
| GEMINI_API_KEY missing | `500` | Secret not configured | Return 500 before processing |
| Unsupported file type | N/A | Extension not in supported list | Material marked `failed` with error |
| Download failed | N/A | File not found in storage bucket | Material marked `failed` with error |

All errors update the `materials` table:
```sql
UPDATE materials
SET processing_status = 'failed',
    processing_error = '<error message>'
WHERE id = '<materialId>';
```

---

## 11. Chunking Configuration

| Parameter | Value |
|-----------|-------|
| Chunk size | 1,200 characters |
| Overlap | 200 characters |
| Step size | 1,000 characters (chunk size − overlap) |
| Normalization | `\r\n` → `\n`, tabs → spaces, collapse multiple spaces |

Chunks are stored in the `chunks` table with `material_id`, `chunk_index`, `start_position`, and `end_position`.
