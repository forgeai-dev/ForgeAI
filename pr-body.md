## Description

Fix Config Sync: exempt `/api/config/sync-receive` from auth middleware so server-side push from another Gateway doesn't get 401 on VPS (bound to `0.0.0.0`).

## Type of Change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [x] Security

## Changes Made

- `packages/core/src/gateway/server.ts`: Added `/api/config/sync-receive` to `AUTH_EXEMPT_EXACT`. This is safe because the endpoint already has its own authentication: AES-256-GCM encryption with one-time sync code, rate limiting, and 5min TTL.

## How to Test

1. Deploy ForgeAI on a VPS with `docker-compose up -d`
2. On VPS Dashboard → Config Sync → Generate Sync Code
3. On local Gateway → Config Sync → Push Config to Remote (enter VPS URL + code)
4. Should succeed without 401 error

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)
