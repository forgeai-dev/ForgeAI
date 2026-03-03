## Summary

Sub-Agent Visibility & Persistence (Phase 1 + 2): Delegation history store, API endpoints, Forge Teams + Delegations rendered in Agents dashboard.

## Changes

### Phase 1: DelegationHistory Store (`packages/agent/src/agent-manager.ts`)
- **DelegationRecord interface**: id, role, task, result, model, provider, status, duration, steps, tokens, timestamps, source
- **delegateTask() now persists results** before cleanup — captures content, steps, tokens, error status
- **History management methods**: `addDelegationRecord()`, `getDelegationHistory()`, `removeDelegation()`, `clearDelegationHistory()`
- Capped at 100 records (FIFO)

### Phase 1: API Endpoints (`packages/core/src/gateway/chat-routes.ts`)
- `GET /api/delegations` — list all delegation history
- `DELETE /api/delegations/:id` — remove specific record
- `DELETE /api/delegations` — clear all history

### Phase 2: Dashboard UI (`packages/dashboard/src/pages/Agents.tsx`)
- **Forge Teams section**: shows active teams with worker status badges (running/completed/failed/pending)
- **Sub-Agentes & Delegações section**: delegation history cards with role, task, result preview, model, duration, tokens, timestamps
- Individual delete + bulk clear for delegations
- Auto-refresh every 10s for live team status

### Dashboard API Types (`packages/dashboard/src/lib/api.ts`)
- Added `DelegationRecord`, `TeamInfo` interfaces
- Added `getDelegations()`, `deleteDelegation()`, `clearDelegations()` API methods
- Updated `getAgents()` return type to include `teams`

## Testing
```
npm run build  # All packages compile
npx vitest run tests/security.test.ts tests/agent.test.ts  # 131 tests pass
```
