## Description

Anti-collision system: shared tool result cache, iteration cap, and delegation trust prompt. Prevents parent and sub-agents from duplicating expensive tool calls (web_browse, web_search). Adds a hard iteration limit of 50 to prevent runaway loops ([X/null] → [X/50]).

## Type of Change

- [x] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **CachedToolExecutor** (`packages/agent/src/agent-manager.ts`):
  - New `CachedToolExecutor` class wrapping the shared `ToolExecutor`
  - Global in-process cache for `web_browse` and `web_search` results (30s TTL)
  - Cache key = tool name + sorted JSON args (excludes internal `_sessionId`)
  - Only caches successful results; errors always re-execute
  - Automatic cleanup every 60s for expired entries
  - Wired in `setToolExecutor()` — all agents (parent + sub) share the same cache
  - Log message on cache hits for observability

- **Iteration cap** (`packages/agent/src/runtime.ts`):
  - `DEFAULT_MAX_ITERATIONS = 50` replaces `Infinity`
  - Progress tracking shows `[X/50]` instead of `[X/null]`
  - On cap: injects "ITERATION LIMIT REACHED" system message, does one final LLM call for summary, then breaks
  - Prevents runaway 30+ minute sessions

- **Delegation trust prompt** (`packages/agent/src/runtime.ts`):
  - Added to system prompt: "Trust sub-agent results. NEVER re-do work that a delegate already completed — use its returned output directly."
  - Reduces redundant verification by the parent agent after delegation

## How to Test

1. `pnpm -r build`
2. Delegate a task (agent_delegate) that uses web_browse
3. Check logs for "⚡ Cache hit" when parent re-browses same URL
4. Verify progress shows `[X/50]` max instead of `[X/null]`

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Backward compatible
