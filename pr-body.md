## Description

Condense the agent system prompt by ~60% (261 lines removed, 67 added) to reduce token usage per LLM iteration, directly cutting latency and cost. Inspired by OpenClaw's minimal prompt approach. All behavioral rules preserved — only verbosity removed.

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [x] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **System prompt condensed** (`packages/agent/src/runtime.ts`): ~280 lines → ~70 lines.
  - Tool descriptions compressed to one-liners (full params already in tool definitions sent to LLM).
  - Removed redundant examples (forge_team example, plan violation examples, dual-env examples).
  - Merged SERVING CONTENT + SERVER NETWORKING + PROXY AWARENESS into single section.
  - Merged SELF-MANAGEMENT + TROUBLESHOOTING + PROCESS PERSISTENCE into CRITICAL RULES.
  - Merged VERIFICATION + LINK DELIVERY into single section.
  - Condensed PLANNING section (removed step-by-step flow, kept core rules).
  - All behavioral rules, restrictions, and critical warnings preserved.

## How to Test

1. `pnpm -r build`
2. `pnpm test` — all tests passing
3. Deploy and test same prompts as before — agent behavior should be identical but faster.
4. Compare token usage: expect ~40-50% reduction in total tokens per task.

## Related Issue

High latency (~350s) and token usage (~164k) observed on simple tasks due to oversized system prompt re-sent every tool-loop iteration.

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)

---

### Impact Analysis

| Metric | Before | After (estimated) |
|--------|--------|-------------------|
| System prompt lines | ~280 | ~70 |
| System prompt tokens | ~5,000 | ~2,000 |
| Tokens saved per iteration | — | ~3,000 |
| 10-iteration task savings | — | ~30,000 tokens |
| Latency reduction | — | ~30-40% |

No rules removed — only verbosity. The PromptOptimizer continues to work complementarily.
