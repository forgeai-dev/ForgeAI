## Description

Update DeepSeek provider to V3.2 pricing and models. Remove deprecated `deepseek-coder` (merged into `deepseek-chat` since V2.5). Update pricing from old rates to V3.2 unified pricing ($0.28/$0.42 per 1M tokens for both chat and reasoner).

## Type of Change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **Pricing updated** (`packages/agent/src/usage-tracker.ts`): DeepSeek V3.2 unified pricing — $0.28/1M input, $0.42/1M output for both `deepseek-chat` and `deepseek-reasoner`. Removed `deepseek-coder`.
- **Provider models** (`packages/agent/src/providers/deepseek.ts`): Removed deprecated `deepseek-coder` model.
- **Provider meta** (`packages/core/src/gateway/chat-routes.ts`): Removed `deepseek-coder` from ALL_PROVIDERS_META.
- **Dashboard** (`packages/dashboard/src/pages/Settings.tsx`): Updated display text to "DeepSeek Chat (V3.2), Reasoner (V3.2)".
- **Balance API**: Already implemented — `getBalance()` calls `https://api.deepseek.com/user/balance` and converts CNY to USD.

## How to Test

1. `pnpm -r build` + `pnpm test`
2. In Dashboard → Settings, DeepSeek should show "Chat (V3.2), Reasoner (V3.2)"
3. Select deepseek-chat or deepseek-reasoner as active model, send a message, verify cost tracking shows correct pricing

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
