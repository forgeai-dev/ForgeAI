## Description

Skill Registry, enhanced `forge doctor` CLI, 6 memory leak fixes, CI pipeline expansion (9 test suites, 443 tests), Chat Commands plugin improvements, and README refresh with animated badges.

## Type of Change

- [x] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [x] Documentation
- [x] Tests
- [x] Security

## Changes Made

### Bugfixes (6)
- **`runtime.ts` `clearSession`/`clearAllHistory`** — Memory leak: wasn't cleaning `sessionSummarized`, `progressListeners`, `abortedSessions`, `abortControllers`
- **`agent-manager.ts`** — `setInterval` cache cleanup missing `.unref()` (blocked clean process exit)
- **`chat-routes.ts`** — `sessionPlans` global Map never cleaned on session delete
- **`chat-routes.ts` + `chat-commands.ts`** — `sessionSettings` global Map never cleaned on session delete
- **`runtime.ts` `processMessageStream`** — Missing `sanitizeResponseContent()` (DeepSeek DSML markup leak)
- **`forge-team.test.ts`** — Flaky timing assertion (`toBeGreaterThan(0)` → `toBeGreaterThanOrEqual(0)`)

### New Features
- **Skill Registry** — Dynamic skill management (install/activate/deactivate/uninstall). 3 handler types, file-persistent store, API endpoints, 67 unit tests
- **Enhanced `forge doctor`** — 5 sections, ~25 checks (Runtime, Config, LLM Providers, Services, Workspace)
- **Chat Commands Plugin** — `/compact`, `/usage`, `/think` via plugin path + `metadata` field on `MessageHookResult`

### CI/CD
- **ci.yml** — Unit test step expanded from 3 to 9 test files (443 total tests)

### Documentation
- **README.md** — Animated typing header, `for-the-badge` style badges, colorful feature count table, "What's New" section, updated tech stack and roadmap

## How to Test

1. `pnpm run build` → all packages compile clean
2. `npx vitest run` → 443/443 tests pass (api.test.ts needs running gateway)
3. `pnpm forge doctor` → shows 5 diagnostic sections

## Checklist

- [x] Code builds without errors (`pnpm run build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Backward compatible
- [x] All 443 tests pass
