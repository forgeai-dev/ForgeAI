## Description

Add backend & fullstack architecture patterns to the agent system prompt. Addresses agent struggling with API+frontend integration (wrong URLs, missing CORS, untested APIs, mixed files).

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **Backend playbook added** (`packages/agent/src/runtime.ts`): 10 concise lines (~200 tokens) covering:
  - Architecture order: backend first → test → then frontend
  - File separation: server.js + public/index.html (never mixed)
  - URL patterns: relative paths (/api/...) for proxy compatibility
  - CORS middleware guidance
  - Static + API serving pattern via ForgeAI proxy
  - Database recommendations (SQLite for simple, MySQL for production)
  - Error handling patterns (try/catch, HTTP status codes)
  - API testing before frontend integration
  - Full integration verification flow

## How to Test

1. `pnpm -r build`
2. `pnpm test` — all tests passing
3. Deploy and ask agent: "Crie uma API Express com CRUD de produtos e um frontend que liste os produtos"
4. Agent should: create API first → test routes → then create frontend with relative URLs

## Related Issue

Agent frequently fails at backend+frontend integration: hardcoded localhost URLs, missing CORS, untested APIs, mixed server+HTML files.

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)
