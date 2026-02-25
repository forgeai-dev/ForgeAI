## Description

Fix Dashboard Overview: hide "Active Agent" section when no LLM provider is configured. Previously, the section would show default agent info (Anthropic) even without any API key configured.

## Type of Change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- `packages/dashboard/src/pages/Overview.tsx`: Added `providers.some(p => p.configured)` condition to only render the Active Agent section when at least one LLM provider has an API key configured

## How to Test

1. `pnpm -r build`
2. `pnpm forge start --migrate`
3. Open Dashboard → Overview
4. With no LLM keys configured: "Active Agent" section should NOT appear
5. After adding an LLM key in Settings: "Active Agent" section should appear

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
