## Description

Upgrade PromptOptimizer to schema v2 with pattern deduplication and aggregation. Replaces naive array storage with fingerprint-based dedup (SHA-256 patternId) and running-average aggregation. Includes automatic v1→v2 migration so existing instances upgrade seamlessly.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **Schema versioning** (`packages/agent/src/prompt-optimizer.ts`):
  - `CURRENT_SCHEMA_VERSION = 2` constant
  - `save()` writes version 2 payload
  - `load()` detects v1 data and auto-migrates (backfills `patternId`, `occurrences`, `avgScore`, `avgDuration`, `avgIterations`, `firstSeen`, `lastSeen`)
  - Unknown versions are safely skipped with a warning

- **Pattern dedup + aggregation**:
  - `generatePatternId(category, toolSequence, keyActions)` — SHA-256 fingerprint for success patterns
  - `generateFailurePatternId(category, failedTools)` — SHA-256 fingerprint for failure patterns
  - `recordOutcome()` — if patternId already exists, aggregates (running averages) instead of creating duplicate
  - `deduplicatePatterns()` — merges any remaining duplicates after migration
  - `pruneSuccessPatterns()` — ranks by `avgScore * recency * confidence` (log-scale confidence boost for multi-occurrence patterns)

- **Improved ranking**:
  - `getRelevantPatterns()` — ranks by `avgScore * timeDecay * confidenceBoost` using `lastSeen` instead of `timestamp`
  - `buildOptimizedContext()` — shows `[Nx proven]` badge and avg metrics in injected context

- **Enhanced stats**:
  - `getStats()` now returns `totalObservations`, `avgPatternOccurrences`, and `topPatterns` (top 5 by score*occurrences)

## How to Test

1. `pnpm -r build` + `pnpm test`
2. Deploy and run several agent tasks in the same category
3. Check `prompt-optimizer.json` — patterns should aggregate (occurrences > 1) instead of duplicating
4. Existing v1 data files auto-migrate on first load (check logs for "Migrating optimizer data v1 → v2")

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Backward compatible (v1 data auto-migrates)
