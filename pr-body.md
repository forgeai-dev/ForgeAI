## Description

Phase 26 — Complete RAG Engine overhaul. Added persistence (documents survive restarts), runtime config API, file upload support (PDF/TXT/MD/code), OpenAI embeddings as alternative to TF-IDF, and a full dashboard page for managing the knowledge base. **18 dashboard pages** total (was 17).

## Type of Change

- [ ] 🐛 Bug fix
- [x] ✨ New feature
- [ ] ♻️ Refactor (no functional changes)
- [x] 📝 Documentation
- [x] 🧪 Tests
- [ ] 🔒 Security

## Changes Made

### 1. RAG Persistence

- Documents saved as JSON to `.forgeai/rag/` directory
- Auto-loaded on gateway startup (TF-IDF re-indexed)
- Config persisted to `_config.json` (survives restarts)
- Safe filename sanitization for document IDs

### 2. Runtime Config API

- `GET /api/rag/config` — get current config
- `POST /api/rag/config` — update any config field at runtime
- All 7 config fields editable: chunkSize, chunkOverlap, maxResults, similarityThreshold, embeddingProvider, embeddingModel, persist

### 3. File Upload

- `POST /api/rag/upload` — multipart file upload
- `@fastify/multipart` registered (50MB limit)
- `extractTextFromFile()` supports 30+ file types: TXT, MD, CSV, JSON, XML, YAML, HTML, PDF, JS, TS, PY, Java, C/C++, CSS, SQL, SH, etc.
- Basic PDF text extraction (BT/ET text streams, no external deps)

### 4. OpenAI Embeddings

- `embeddingProvider: 'openai'` — uses `text-embedding-3-small` via OpenAI API
- Batch embedding for efficient ingestion (`embedOpenAIBatch`)
- `ingestAsync()` — async ingest with OpenAI embeddings
- `searchAsync()` — async search with OpenAI query embeddings
- Auto-fallback to TF-IDF if API key missing or request fails

### 5. Dashboard RAG Page (18th page)

- **Documents tab**: list all documents with metadata, chunk count, size, delete
- **Search tab**: semantic search with score display
- **Upload tab**: file upload (drag & drop) + paste text ingest
- **Settings tab**: edit all config fields, embedding provider selector, save/cancel

---

## Files Changed (10 files)

| File | Change |
|:-----|:-------|
| `packages/agent/src/rag-engine.ts` | Persistence, config API, OpenAI embeddings, file extraction, ingestAsync, searchAsync |
| `packages/agent/src/index.ts` | Export extractTextFromFile, EmbeddingProvider type |
| `packages/core/src/gateway/server.ts` | Register @fastify/multipart plugin |
| `packages/core/src/gateway/chat-routes.ts` | RAG config endpoints, file upload endpoint |
| `packages/core/package.json` | Added @fastify/multipart dependency |
| `packages/dashboard/src/pages/RAG.tsx` | **NEW** — Full RAG management page |
| `packages/dashboard/src/App.tsx` | Register /rag route |
| `packages/dashboard/src/components/Layout.tsx` | Add RAG to sidebar nav |
| `README.md` | 26 phases, 18 pages, RAG upgrade in roadmap |
| `tests/api.test.ts` | Added RAG config GET/POST tests (57 total) |

## How to Test

1. `pnpm -r build`
2. `pnpm forge start --migrate`
3. `pnpm test` — expect **57/57 tests passing**
4. Open dashboard → RAG page → upload a .txt or .md file
5. Switch to Search tab → search for content from uploaded file
6. Settings tab → change embedding provider or chunk size → Save
7. Restart gateway → verify documents are still there (persistence)

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`) — 57/57
- [x] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [x] No secrets or API keys committed
- [x] Documentation updated (README roadmap, dashboard page count)
