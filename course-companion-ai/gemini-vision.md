# Gemini Vision API — Usage & Constraints

Reference documentation for how this project uses the Google Gemini API for document text extraction and embedding generation.

---

## 1. API Endpoint & Model

| Purpose | Endpoint | Model |
|---------|----------|-------|
| **Text extraction (Vision)** | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` | `gemini-2.5-flash` |
| **Embeddings** | `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent` | `gemini-embedding-001` |

Both are called from the `parse-document` edge function using the `GEMINI_API_KEY` secret.

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
The system prompt instructs Gemini to preserve structure (headings, lists, tables, formulas) and return **only** raw text — no summaries or commentary.

### Temperature
Set to `0` for deterministic, faithful text extraction. This minimizes hallucination and ensures consistent output across retries.

---

## 3. Supported MIME Types

### Gemini Vision (PDF & images)

| Extension | MIME Type | Notes |
|-----------|-----------|-------|
| `.pdf` | `application/pdf` | Native support, up to ~100 pages |
| `.png` | `image/png` | OCR for scanned/handwritten content |
| `.jpg` / `.jpeg` | `image/jpeg` | OCR for scanned/handwritten content |
| `.webp` | `image/webp` | Supported |
| `.gif` | `image/gif` | Supported (first frame for animated) |
| `.heic` / `.heif` | `image/heic` | Supported by Gemini but not used in our upload UI |

### Handled via XML parsing (no API call)

| Extension | Method | Notes |
|-----------|--------|-------|
| `.docx` | ZIP → `word/document.xml` → extract `<w:t>` tags | No Gemini API call needed |
| `.pptx` | ZIP → `ppt/slides/slide*.xml` → extract `<a:t>` tags | Slide numbers preserved |

### Not supported

| Extension | Reason |
|-----------|--------|
| `.doc` | Legacy binary format — users must convert to `.docx` |
| `.ppt` | Legacy binary format — not implemented |
| `.xls` / `.xlsx` | Not implemented (could be added via XML parsing) |

---

## 4. Constraints & Limits

### Free Tier (Google AI Studio API key)

| Constraint | Limit |
|------------|-------|
| Requests per minute (RPM) | 15 |
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
- **PDF page count**: Documents with >50 pages may time out or produce truncated output. Consider splitting into page ranges for large PDFs.
- **Edge function timeout**: Default is **60 seconds**. Large documents with many chunks may exceed this. The function processes chunks sequentially.
- **Chunk batching**: Embeddings are generated one chunk at a time. A 50-page PDF may produce ~40+ chunks, requiring ~40 embedding API calls.

---

## 6. Rate Limiting & Retry Strategy

### Current implementation

1. If a **429 (rate limited)** response is received during embedding generation:
   - Wait **2 seconds**
   - Retry the request **once**
   - If the retry also fails, the entire job is marked as `failed`

2. If a **429** is received during Vision text extraction:
   - The error is thrown immediately with a descriptive message
   - The material is marked as `failed` with the error details

### Recommendations for improvement

- Implement exponential backoff (2s → 4s → 8s) for embedding calls
- Add a request queue to stay within 15 RPM on free tier
- For bulk uploads, add delays between documents (4s minimum between Vision calls)

---

## 7. Edge Function Timeout Considerations

| Document type | Typical processing time | Risk |
|---------------|------------------------|------|
| Single image (OCR) | 3–8 seconds | Low |
| Short PDF (<10 pages) | 5–15 seconds | Low |
| Medium PDF (10–30 pages) | 15–40 seconds | Medium |
| Large PDF (30–50 pages) | 30–60+ seconds | High — may timeout |
| DOCX (any size) | 1–3 seconds | Very low (no API call) |
| PPTX (any size) | 1–5 seconds | Very low (no API call) |

The edge function timeout is **60 seconds** by default. Processing includes: download + extraction + chunking + N embedding calls.

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
| Rate limit exceeded | `429` | Too many requests per minute/day | Retry after backoff; material marked `failed` |
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
