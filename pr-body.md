## Description

Activity Monitoring System — comprehensive logging, dashboard UI, and host command rate limiting for enhanced security visibility.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [x] Security

## Changes Made

### Activity Monitoring Backend
- `packages/core/src/database/migrations/004_activity_log.ts`: New migration for `activity_log` table with indexes on timestamp, type, target, risk_level
- `packages/core/src/database/connection.ts`: Added `applyMigration004` to migration runner
- `packages/core/src/database/activity-store.ts`: `ActivityStore` service with insert, query (with filters), getStats (today's counts), cleanup, and `generateActivitySummary()` for human-readable descriptions

### Activity Callback in ToolRegistry
- `packages/tools/src/registry.ts`: Added `ActivityCallback` type and `onActivity()` method — fires on every tool execution (success, failure, blocked)
- `packages/tools/src/index.ts`: Exported `ActivityCallback` type

### API Endpoints
- `packages/core/src/gateway/chat-routes.ts`: 
  - `GET /api/activity` — list activities with filters (type, target, riskLevel, success, limit, offset)
  - `GET /api/activity/stats` — today's totals (total, host, blocked, errors)
  - Wired `ActivityStore` into `ToolRegistry.onActivity()` at initialization

### Dashboard Activity Page
- `packages/dashboard/src/pages/Activity.tsx`: Full Activity Monitor page with:
  - Stats cards (total, host commands, blocked, errors)
  - Filterable feed by target (Container/Host/Companion) and risk level
  - Auto-refresh (5s) with live/paused toggle
  - Color-coded risk badges with warning icons for high/critical
  - Host command rows highlighted in amber, blocked in red
  - Duration display, command preview, time-ago formatting
- `packages/dashboard/src/App.tsx`: Added `/activity` route
- `packages/dashboard/src/components/Layout.tsx`: Added Activity nav item with Activity icon
- `packages/dashboard/src/lib/api.ts`: Added `getActivity()` and `getActivityStats()` API methods
- `packages/dashboard/src/lib/i18n.ts`: Added `nav.activity` translations (en, pt, es) and NAV_KEYS mapping

### Host Command Rate Limiting
- `packages/tools/src/tools/shell-exec.ts`: Sliding-window rate limiter (10 commands/minute) for `target="host"` commands

### Host Networking & Any-Port Access
- `docker-compose.yml`: Gateway switched to `network_mode: host`
- `packages/core/src/gateway/chat-routes.ts`: `/apps/:port/*` allows any port 1024-65535 except reserved (18800, 3306)
- `packages/agent/src/runtime.ts`: System prompt updated for any-port and `target="host"`

## How to Test

1. **Activity Logging**: Execute any tool via chat → check `/activity` page for logged entry with summary
2. **Host Rate Limit**: Run 11 `shell_exec(target="host")` commands rapidly → 11th should be blocked
3. **Dashboard**: Navigate to Activity page → verify live refresh, filters, stats cards
4. **Any-Port Proxy**: Start a server on port 8080 → access via `/apps/8080/`

## Related Issue

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Database migration included
