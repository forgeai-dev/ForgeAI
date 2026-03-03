## Description

Phase 3: Real-time WebSocket streaming of sub-agent progress + App deletion bug fix + ProjectDelete tool.

Sub-agents now stream their progress (tool calls, thinking, steps) in real-time to the parent session's dashboard via WebSocket. Also fixes the bug where deleted apps remained accessible via their port URL, and adds a comprehensive `project_delete` tool.

## Type of Change

- [x] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

### Phase 3: Real-time Sub-Agent Streaming
- **`AgentManager.setProgressBroadcaster()`** — new method to register a callback that forwards sub-agent progress events to the parent session
- **`delegateTask()` registers `onProgress` listener** on delegate runtimes — events prefixed with `delegate.` (progress/step/done) are broadcast to the parent session via WebSocket
- **Gateway wiring** in `chat-routes.ts` — connects the broadcaster to `wsBroadcaster.broadcastToSession()`
- **Chat.tsx delegate progress UI** — new `delegateProgress` state tracks active sub-agents, renders purple-themed cards with role, iteration, tool calls, and step history in real-time

### Bug Fix: App Deletion
- **Proxy 404 for unregistered ports** — `/apps/:portOrName/*` now returns 404 if port-based lookup finds no registered app, instead of proxying and showing "Application Offline"
- **`project_delete` tool** — comprehensive cleanup: stops process, kills port, removes from `appRegistry`, persists to vault, deletes project files

### Phase 1+2 (from previous session)
- DelegationRecord persistence, delegation history API, Forge Teams + delegations in Agents dashboard

## How to Test

1. `pnpm -r build`
2. `pnpm forge start --migrate`
3. `pnpm test` — expect all tests passing (131 pass)
4. Open dashboard → Chat → trigger `agent_delegate` → verify sub-agent progress appears in purple cards with live tool calls
5. Delete an app → verify its port URL returns 404
6. Ask agent to use `project_delete` → verify full cleanup (process, registry, files)

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
