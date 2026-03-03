## Problem

When the agent creates dynamic apps, it starts them with a fragile background process that dies easily. When the app crashes, the proxy returns raw JSON exposing internal tool names, which then triggers Prompt Guard false positives when users paste the error back.

## Solution

### AppManager (app-manager.ts)
- Full process lifecycle: spawn, monitor, auto-restart with exponential backoff (up to 5 restarts)
- Health checks every 30s (HTTP HEAD probe on app port)
- Graceful shutdown: SIGTERM then SIGKILL after 5s
- Per-app status tracking: running/stopped/crashed/starting

### Beautiful Offline Page
- Dark-themed HTML error page replaces raw JSON when app is down
- Auto-refreshes every 15s, no internal details exposed

### Managed App Registration
- POST /api/apps/register now accepts cwd, command, args to start as managed process
- New endpoints: restart, stop, list managed apps
- Registry now includes status, PID, restart count, last health check

### System Prompt Updates
- Agent instructed to use managed registration over background processes
- Must verify app URL works before presenting to user

### Files Changed

| File | Changes |
|------|---------|
| `packages/core/src/gateway/app-manager.ts` | NEW: AppManager class + generateAppDownPage |
| `packages/core/src/gateway/chat-routes.ts` | Managed registration, control endpoints, HTML error page |
| `packages/core/src/gateway/server.ts` | Subdomain proxy uses HTML error page |
| `packages/agent/src/runtime.ts` | System prompt with managed app instructions |
