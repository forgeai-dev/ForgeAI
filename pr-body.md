## Description

Fix 429 Too Many Requests cascade on VPS + DeepSeek Reasoner compatibility.

## Type of Change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **Rate limiter exempt list** (`packages/core/src/gateway/server.ts`):
  - Added `/api/agents`, `/api/delegations`, `/api/chat/active`, `/api/settings/language`, `/api/providers/balances` to exact exempt set
  - Added `/api/chat/sessions/`, `/api/settings/` to prefix exempt list
  - Prevents 429 cascade when WebSocket disconnects and dashboard polls aggressively

- **DeepSeek Reasoner compatibility** (`packages/agent/src/providers/openai-compatible.ts`):
  - Detect `reasoner` models (e.g. `deepseek-reasoner`)
  - Skip `temperature` param (API rejects it for reasoner models)
  - Skip `tools` param (reasoner models don't support function calling)
  - Applied to both `chat()` and `chatStream()` methods

## How to Test

1. `pnpm -r build`
2. Set `deepseek-reasoner` as main model → send message via Telegram → should get a response (no API error)
3. Open dashboard on VPS → no 429 errors in console
4. Kill WebSocket connection → dashboard should still work via HTTP polling without hitting rate limit

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Backward compatible
