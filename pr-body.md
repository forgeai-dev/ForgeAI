## Description

Sub-Agent Visibility & Persistence (Phase 1 + 2): Delegation history store persists sub-agent results instead of deleting them, new API endpoints expose delegation history, and the Agents dashboard now renders Forge Teams and delegation history with full CRUD.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **DelegationRecord interface** added to `agent-manager.ts`: id, role, task, result, model, provider, status, duration, steps, tokens, timestamps, source
- **delegateTask() now persists results** before cleanup — captures content, steps, tokens, error status into in-memory history (capped at 100 FIFO)
- **History management methods**: `addDelegationRecord()`, `getDelegationHistory()`, `removeDelegation()`, `clearDelegationHistory()`
- **API endpoints** in `chat-routes.ts`: `GET /api/delegations`, `DELETE /api/delegations/:id`, `DELETE /api/delegations`
- **Forge Teams section** in Agents dashboard: active teams with worker status badges (running/completed/failed/pending)
- **Sub-Agentes & Delegações section** in Agents dashboard: delegation history cards with role, task, result preview, model, duration, tokens, timestamps
- Individual delete + bulk clear for delegations
- Auto-refresh every 10s for live team status
- Dashboard API types: `DelegationRecord`, `TeamInfo` interfaces + `getDelegations()`, `deleteDelegation()`, `clearDelegations()` methods

## How to Test

1. `pnpm -r build`
2. `pnpm forge start --migrate`
3. `pnpm test` — expect all tests passing (131 pass)
4. Open dashboard → Agents page → verify Forge Teams and Delegations sections appear after sub-agent activity
5. Use `agent_delegate` or `forge_team` tools → verify delegation records appear in dashboard
6. Delete individual records and clear all → verify cleanup works

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`) — 131 tests pass
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)
